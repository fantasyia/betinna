import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type UserRole } from '@prisma/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
import { TransactionalEmailService } from '@integrations/email/transactional-email.service';
import { EvolutionInstanciaService } from '@integrations/evolution/evolution-instancia.service';
import { KanbanTarefaService } from '@modules/kanban/kanban-tarefa.service';
import {
  BusinessRuleException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { isGlobalAdmin } from '@shared/utils/auth-context';
import { buildPaginated, type Paginated } from '@shared/types/pagination';
import type {
  CreateUserDto,
  ListUsersDto,
  UpdateMeDto,
  UpdateUserDto,
  UpdateRepDiscountLimitDto,
  UpdateComissaoPercentualDto,
} from './users.dto';

/**
 * Users — CRUD com integração ao Supabase Auth.
 *
 * Fluxo de criação:
 * 1. Cria o usuário no Supabase Auth (inviteUserByEmail) → recebe `id`
 * 2. Cria o registro em `Usuario` com o mesmo `id`
 * 3. Vincula às empresas via UsuarioEmpresa
 *
 * O usuário recebe e-mail de convite do próprio Supabase com link
 * para definir a senha.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly supabaseAdmin: SupabaseClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly redis: RedisService,
    private readonly email: TransactionalEmailService,
    private readonly evolutionInstancias: EvolutionInstanciaService,
    private readonly kanbanTarefa: KanbanTarefaService,
  ) {
    this.supabaseAdmin = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  /**
   * Resolve a URL de redirect pós-convite (Supabase Auth).
   *
   * IMPORTANTE: o domínio resolvido aqui PRECISA estar autorizado em
   *   Supabase → Auth → URL Configuration → Redirect URLs
   * caso contrário o Supabase ignora e cai no `Site URL` (que é
   * `http://localhost:3000` por default), gerando ERR_CONNECTION_REFUSED
   * no email do user.
   *
   * Hotpatch 2026-05-22: antes calculava `SUPABASE_URL.replace('.supabase.co',
   * '.app')` — produzia URL inexistente. Agora usa FRONTEND_URL (env)
   * com fallback pra primeiro CORS_ORIGINS ou localhost (dev).
   */
  private resolveInviteRedirectUrl(): string {
    const fromEnv = this.env.get('FRONTEND_URL');
    if (fromEnv) return `${fromEnv.replace(/\/$/, '')}/welcome`;
    const cors = this.env.get('CORS_ORIGINS').split(',')[0]?.trim();
    const base = (cors ?? 'http://localhost:5173').replace(/\/$/, '');
    return `${base}/welcome`;
  }

  /**
   * Invalida o cache de auth do usuário no Redis.
   * Chame após qualquer mudança que afete role, status, ou empresas vinculadas.
   */
  private async invalidateAuthCache(userId: string): Promise<void> {
    await AuthGuard.invalidate(this.redis, userId).catch((err) => {
      this.logger.warn(
        `Falha invalidando auth cache de ${userId}: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  /**
   * Hardening 2026-05-16 (ALTA-2 audit): garante que o `caller` só pode
   * mutar usuários que pertencem à sua empresa ativa.
   *
   * - ADMIN: bypass total (cross-tenant)
   * - DIRECTOR/GERENTE: só age em usuários vinculados à `empresaIdAtiva`
   * - Outros: bloqueado
   *
   * Use em update/setStatus/setRepDiscountLimit/setComissaoPercentual/resendInvite.
   * Retorna o user encontrado (com empresas) pra evitar findUnique duplicado.
   */
  private async loadAndAssertScope(
    caller: AuthenticatedUser,
    targetId: string,
  ): Promise<{
    id: string;
    email: string;
    nome: string;
    role: UserRole;
    status: 'ATIVO' | 'PENDENTE' | 'INATIVO';
    /** Documento atual — o update compara pra saber se o vínculo com o ERP caiu. */
    cpfCnpj: string | null;
    empresas: Array<{ empresaId: string }>;
  }> {
    const user = await this.prisma.usuario.findUnique({
      where: { id: targetId },
      include: { empresas: { select: { empresaId: true } } },
    });
    if (!user) throw new NotFoundException('Usuário', targetId);
    if (isGlobalAdmin(caller)) return user;
    const callerEmpresa = caller.empresaIdAtiva;
    if (!callerEmpresa) {
      throw new ForbiddenException(
        'Empresa não definida no contexto',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    const inScope = user.empresas.some((e) => e.empresaId === callerEmpresa);
    if (!inScope) {
      throw new ForbiddenException(
        'Usuário não pertence à sua empresa',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user;
  }

  async list(user: AuthenticatedUser, params: ListUsersDto): Promise<Paginated<unknown>> {
    // AUDITORIA 2026-05-15 P0: ADMIN pode filtrar por qualquer empresa.
    // DIRECTOR/GERENTE só podem ver usuários da própria empresa ativa.
    // - Se ADMIN passa params.empresaId, respeita.
    // - Se ADMIN não passa, mostra TODOS (cross-tenant).
    // - Se DIRECTOR/GERENTE passa params.empresaId, valida que é a própria.
    // - Se DIRECTOR/GERENTE não passa, força empresa ativa.
    let empresaIdFiltro = params.empresaId;
    if (!isGlobalAdmin(user)) {
      if (!user.empresaIdAtiva) {
        throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
      }
      if (empresaIdFiltro && empresaIdFiltro !== user.empresaIdAtiva) {
        throw new ForbiddenException(
          'Você só pode listar usuários da sua empresa ativa',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      empresaIdFiltro = user.empresaIdAtiva;
    }

    const where: Prisma.UsuarioWhereInput = {
      ...(params.search
        ? {
            OR: [
              { nome: { contains: params.search, mode: 'insensitive' } },
              { email: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(params.role ? { role: params.role } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(empresaIdFiltro ? { empresas: { some: { empresaId: empresaIdFiltro } } } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
        include: {
          empresas: {
            include: { empresa: { select: { id: true, nome: true } } },
          },
        },
      }),
    ]);

    return buildPaginated(items.map(this.serialize), total, params.page, params.limit);
  }

  /**
   * Atualiza o PRÓPRIO cadastro. O alvo é sempre `caller.id` — não recebe id de
   * fora, então não há como apontar pra outra pessoa. Os campos permitidos vêm
   * do `updateMeSchema` (nome/telefone).
   */
  async updateMe(caller: AuthenticatedUser, dto: UpdateMeDto) {
    const atual = await this.prisma.usuario.findUnique({ where: { id: caller.id } });
    if (!atual) throw new NotFoundException('Usuário', caller.id);
    const atualizado = await this.prisma.usuario.update({
      where: { id: caller.id },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome.trim() } : {}),
        ...(dto.telefone !== undefined ? { telefone: dto.telefone.trim() } : {}),
      },
      include: {
        empresas: { include: { empresa: { select: { id: true, nome: true } } } },
      },
    });
    return this.serialize(atualizado);
  }

  async findById(caller: AuthenticatedUser, id: string) {
    // Ler o PRÓPRIO cadastro é livre — é a tela /perfil, que todo mundo tem.
    // Pra ler o de outra pessoa vale a regra de sempre. (Este teste ficava no
    // @Roles do controller, o que barrava o REP no próprio perfil.)
    if (id !== caller.id && !['ADMIN', 'DIRECTOR', 'GERENTE'].includes(caller.role)) {
      throw new ForbiddenException('Você só pode ver o seu próprio cadastro.', ErrorCode.FORBIDDEN);
    }
    const target = await this.prisma.usuario.findUnique({
      where: { id },
      include: {
        empresas: { include: { empresa: { select: { id: true, nome: true } } } },
      },
    });
    if (!target) throw new NotFoundException('Usuário', id);

    // AUDITORIA: DIRECTOR/GERENTE só veem usuários da própria empresa
    if (!isGlobalAdmin(caller)) {
      const callerEmpresa = caller.empresaIdAtiva;
      if (!callerEmpresa) {
        throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
      }
      const compartilham = target.empresas.some((e) => e.empresaId === callerEmpresa);
      if (!compartilham) {
        // Não vaza existência cross-tenant
        throw new NotFoundException('Usuário', id);
      }
    }

    return this.serialize(target);
  }

  async create(caller: AuthenticatedUser, dto: CreateUserDto) {
    // 0) Regras de escopo do CALLER (U2 — lote 4, 2026-05-22):
    //    - ADMIN: pode criar em qualquer empresa, qualquer papel (mantido).
    //    - DIRECTOR: só na própria empresa ativa e NÃO pode criar
    //      ADMIN nem outro DIRECTOR (proteção contra escalada).
    if (!isGlobalAdmin(caller)) {
      if (caller.role !== 'DIRECTOR') {
        throw new ForbiddenException(
          'Apenas ADMIN ou DIRECTOR podem convidar usuários',
          ErrorCode.FORBIDDEN,
        );
      }
      if (dto.role === 'ADMIN' || dto.role === 'DIRECTOR') {
        throw new BusinessRuleException('DIRECTOR não pode convidar outro DIRECTOR ou ADMIN');
      }
      const callerEmpresa = caller.empresaIdAtiva;
      if (!callerEmpresa) {
        throw new ForbiddenException(
          'Empresa não definida no contexto',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      // Força que o convite seja APENAS pra empresa ativa do DIRECTOR
      const fora = dto.empresaIds.filter((id) => id !== callerEmpresa);
      if (fora.length > 0) {
        throw new BusinessRuleException(
          'DIRECTOR só pode convidar usuários para a empresa ativa dele',
        );
      }
    }

    // 1) Verifica conflito de e-mail no nosso banco
    const exists = await this.prisma.usuario.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Já existe usuário com este e-mail');

    // 2) Confere que todas as empresas existem e estão ativas
    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: dto.empresaIds } },
      select: { id: true, ativo: true },
    });
    if (empresas.length !== dto.empresaIds.length) {
      throw new NotFoundException('Uma ou mais empresas');
    }
    if (empresas.some((e) => !e.ativo)) {
      throw new BusinessRuleException('Não é possível vincular usuário a empresa inativa');
    }

    // AUDITORIA (média): esta validação vinha DEPOIS do convite no Supabase.
    // `gerenteId` inválido → o e-mail já tinha sido criado no Auth, o create no
    // nosso banco nunca acontecia, e aquele endereço ficava ÓRFÃO e INUTILIZÁVEL
    // pra sempre (o inviteUserByEmail recusa e-mail já existente). Toda validação
    // barata roda ANTES de tocar em sistema externo.
    if (dto.gerenteId) {
      await this.assertGerenteValido(dto.gerenteId);
    }

    // 3) Cria no Supabase Auth (envia convite por e-mail)
    const redirectTo = this.resolveInviteRedirectUrl();
    const { data: authData, error } = await this.supabaseAdmin.auth.admin.inviteUserByEmail(
      dto.email,
      { data: { nome: dto.nome, role: dto.role }, redirectTo },
    );
    if (error || !authData.user) {
      throw new BusinessRuleException(
        `Falha ao criar usuário no Supabase: ${error?.message ?? 'erro desconhecido'}`,
      );
    }

    // 4) Cria registro no nosso banco.
    // COMPENSAÇÃO: se falhar aqui (unique, FK, banco fora), o usuário do Supabase
    // já existe. Sem desfazer, o e-mail fica órfão — o Auth tem o registro, nós
    // não, e uma nova tentativa com o mesmo e-mail é recusada pelo Supabase.
    let created;
    try {
      created = await this.prisma.usuario.create({
        data: {
          id: authData.user.id,
          email: dto.email,
          nome: dto.nome,
          telefone: dto.telefone,
          cpfCnpj: dto.cpfCnpj ?? null,
          role: dto.role,
          status: 'PENDENTE',
          regiao: dto.regiao,
          tetoDesconto: dto.tetoDesconto ?? (dto.role === 'REP' ? 5 : null),
          comissaoPadrao: dto.comissaoPadrao ?? (dto.role === 'REP' ? 5 : null),
          gerenteId: dto.role === 'REP' ? (dto.gerenteId ?? null) : null,
          empresas: {
            create: dto.empresaIds.map((empresaId) => ({ empresaId })),
          },
        },
        include: {
          empresas: { include: { empresa: { select: { id: true, nome: true } } } },
        },
      });
    } catch (err) {
      await this.supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch((e: unknown) => {
        // Falhou o rollback: o e-mail fica órfão MESMO. Log alto e nomeado pra
        // alguém apagar no painel do Supabase — pior que o erro é não saber.
        this.logger.error(
          `ROLLBACK FALHOU: usuário ${dto.email} (${authData.user.id}) ficou órfão no Supabase Auth ` +
            `e precisa ser removido à mão. Causa: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      throw err;
    }
    this.logger.log(`Usuário criado: ${created.id} (${created.role})`);

    // REP já nasce com o quadro de tarefas dele (colunas padrão). Best-effort:
    // falha aqui não desfaz a criação do usuário — só loga.
    if (created.role === 'REP') {
      for (const vinc of created.empresas ?? []) {
        try {
          // usa o ESCALAR empresaId (sempre presente) — vinc.empresa.id dependia
          // do include e, se undefined, o próprio catch re-explodia (500 no create)
          await this.kanbanTarefa.garantirQuadroRep(vinc.empresaId, created.id, created.nome);
        } catch (err) {
          this.logger.warn(
            `Falha ao provisionar quadro do rep ${created.id} na empresa ${vinc.empresaId}: ${String(err)}`,
          );
        }
      }
    }

    // E-mail de boas-vindas — complementa o magic link do Supabase com
    // contexto da empresa + CTA pro frontend. Aguardamos o resultado: se o
    // e-mail falhar, o usuário FOI criado, mas sinalizamos pra UI avisar o
    // admin (toast) em vez de mostrar "convite enviado" falso.
    const empresaNome = created.empresas?.[0]?.empresa?.nome ?? 'sua empresa';
    const emailResult = await this.email.enviarBoasVindas({
      para: created.email,
      nome: created.nome,
      empresaNome,
    });

    const serialized = this.serialize(created);
    if (!emailResult.ok) {
      this.logger.error(
        `Usuário ${created.email} criado, mas e-mail de convite FALHOU: ` +
          `${emailResult.motivo ?? 'motivo desconhecido'}`,
      );
      return {
        ...serialized,
        emailAviso: emailResult.motivo ?? 'Falha ao enviar e-mail de convite.',
      };
    }
    return serialized;
  }

  async update(caller: AuthenticatedUser, id: string, dto: UpdateUserDto) {
    const user = await this.loadAndAssertScope(caller, id);

    const { empresaIds, gerenteId, ...rest } = dto;

    // Validação hierarquia. Se dto.gerenteId for definido, exige que apontante seja REP.
    if (gerenteId) {
      await this.assertGerenteValido(gerenteId);
      const targetRole = dto.role ?? user.role;
      if (targetRole !== 'REP') {
        throw new BusinessRuleException('Apenas REP pode ter gerente atribuído');
      }
    }
    // Trocar role pra algo != REP zera gerenteId
    const dataPatch: Prisma.UsuarioUpdateInput = { ...rest };
    // Documento corrigido = o vínculo com o contato do ERP pode estar apontando
    // pra pessoa errada. Zera o `contatoErpId` pra rodada diária refazer o
    // casamento pelo documento novo, em vez de manter o cadastro errado.
    if (dto.cpfCnpj !== undefined && dto.cpfCnpj !== user.cpfCnpj) {
      dataPatch.contatoErpId = null;
    }
    if (gerenteId !== undefined)
      dataPatch.gerente = gerenteId ? { connect: { id: gerenteId } } : { disconnect: true };
    if (dto.role && dto.role !== 'REP') {
      dataPatch.gerente = { disconnect: true };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (empresaIds) {
        await tx.usuarioEmpresa.deleteMany({ where: { usuarioId: id } });
        await tx.usuarioEmpresa.createMany({
          data: empresaIds.map((empresaId) => ({ usuarioId: id, empresaId })),
        });
      }
      // CAÇADA-BUG #52: se o usuário DEIXA de ser GERENTE (troca de papel), os REPs que apontavam pra
      // ele ficam com `gerenteId` pendurado (apontando pra um não-GERENTE) → RepScopeService não os
      // associa a gerente nenhum e o catch-all do DIRECTOR só vale pra gerenteId null → carteira mal
      // atribuída. Anula o gerenteId dos subordinados (mesmo cleanup do setStatus/D42). Antes só o
      // setStatus(INATIVO) fazia isso; o update() de role não.
      if (dto.role && dto.role !== 'GERENTE' && user.role === 'GERENTE') {
        await tx.usuario.updateMany({ where: { gerenteId: id }, data: { gerenteId: null } });
      }
      const updated = await tx.usuario.update({
        where: { id },
        data: dataPatch,
        include: {
          empresas: { include: { empresa: { select: { id: true, nome: true } } } },
        },
      });
      return this.serialize(updated);
    });
    // Mudanças de role/empresas/status afetam decisão de auth — invalida cache
    await this.invalidateAuthCache(id);
    return result;
  }

  async setStatus(caller: AuthenticatedUser, id: string, status: 'ATIVO' | 'INATIVO') {
    const user = await this.loadAndAssertScope(caller, id);

    // Quando GERENTE é desativado, os REPs sob sua gerência viram órfãos.
    // gerenteId=null → carteira gerida pelo DIRECTOR/ADMIN (catch-all).
    if (status === 'INATIVO' && user.role === 'GERENTE') {
      const { count } = await this.prisma.usuario.updateMany({
        where: { gerenteId: id },
        data: { gerenteId: null },
      });
      if (count > 0) {
        this.logger.log(
          `GERENTE ${id} desativado — ${count} rep(s) realocado(s) pra carteira do diretor`,
        );
      }
    }

    const updated = await this.prisma.usuario.update({ where: { id }, data: { status } });
    // Status muda → AuthGuard cache deve refletir imediatamente
    await this.invalidateAuthCache(id);
    // Cleanup on-deactivation: desconecta + deleta a instância WhatsApp pessoal do rep no Evolution
    // (best-effort, fire-and-forget — não bloqueia/derruba a desativação).
    if (status === 'INATIVO') {
      void this.evolutionInstancias.desativar({ type: 'USUARIO', id });
    }
    return updated;
  }

  async setRepDiscountLimit(
    caller: AuthenticatedUser,
    id: string,
    dto: UpdateRepDiscountLimitDto,
  ): Promise<void> {
    const user = await this.loadAndAssertScope(caller, id);
    if (user.role !== 'REP') {
      throw new BusinessRuleException('Apenas representantes têm teto de desconto configurável');
    }
    // Re-verify scope inside transaction to close TOCTOU window.
    // Usuario has no empresaId column; scope is via UsuarioEmpresa join table.
    const callerEmpresa = caller.empresaIdAtiva ?? user.empresas[0]?.empresaId;
    await this.prisma.$transaction(async (tx) => {
      const stillInScope = await tx.usuarioEmpresa.findFirst({
        where: { usuarioId: id, empresaId: callerEmpresa },
        select: { usuarioId: true },
      });
      if (!stillInScope) {
        throw new ForbiddenException(
          'Usuário não pertence à sua empresa',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      await tx.usuario.update({
        where: { id },
        data: { tetoDesconto: dto.tetoDesconto },
      });
    });
  }

  /**
   * Define a comissão (%) para REP ou GERENTE. Apenas ADMIN/DIRECTOR
   * (controle no controller).
   *
   * REP    → comissão direta sobre os pedidos da própria carteira
   * GERENTE → comissão sobre o total de vendas dos REPs sob sua gerência
   */
  async setComissaoPercentual(
    caller: AuthenticatedUser,
    id: string,
    dto: UpdateComissaoPercentualDto,
  ): Promise<void> {
    const user = await this.loadAndAssertScope(caller, id);
    if (user.role !== 'REP' && user.role !== 'GERENTE') {
      throw new BusinessRuleException('Comissão configurável apenas para REP ou GERENTE');
    }
    // Re-verify scope inside transaction to close TOCTOU window.
    // Usuario has no empresaId column; scope is via UsuarioEmpresa join table.
    const callerEmpresa = caller.empresaIdAtiva ?? user.empresas[0]?.empresaId;
    await this.prisma.$transaction(async (tx) => {
      const stillInScope = await tx.usuarioEmpresa.findFirst({
        where: { usuarioId: id, empresaId: callerEmpresa },
        select: { usuarioId: true },
      });
      if (!stillInScope) {
        throw new ForbiddenException(
          'Usuário não pertence à sua empresa',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      await tx.usuario.update({
        where: { id },
        data: { comissaoPadrao: dto.comissaoPadrao },
      });
    });
  }

  /**
   * Regera o convite e DEVOLVE o link, além de tentar mandar por e-mail.
   *
   * Devolver o link importa porque o e-mail é o elo frágil: tenant sem Resend
   * configurado (ou endereço que não recebe) deixava o admin sem NENHUM caminho
   * — o método falhava inteiro e o convite regerado se perdia. Agora o admin
   * sempre fica com o link em mãos e decide como entregar.
   *
   * ⚠️ O link cadastra a senha de quem clicar. Só volta pra ADMIN (gate no
   * controller), que já podia regerar convite desse usuário de qualquer forma —
   * não abre poder novo, só torna utilizável o que já existia.
   */
  async resendInvite(
    caller: AuthenticatedUser,
    id: string,
  ): Promise<{
    ok: true;
    sentTo: string;
    inviteUrl: string;
    emailEnviado: boolean;
    motivo?: string;
  }> {
    const userScope = await this.loadAndAssertScope(caller, id);
    if (userScope.status !== 'PENDENTE') {
      throw new BusinessRuleException('Usuário não está com convite pendente');
    }

    // Bug fix 2026-05-23: `inviteUserByEmail` SÓ funciona pra criar novo
    // usuário no Supabase Auth. Como o user já existe (status PENDENTE),
    // a chamada retornava "A user with this email address has already been
    // registered". A solução é usar `generateLink({ type: 'invite' })` que
    // aceita user existente — porém o Supabase NÃO envia email automático
    // pra esse método, então enviamos manualmente via Resend.
    const redirectTo = this.resolveInviteRedirectUrl();
    let { data, error } = await this.supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: userScope.email,
      options: { redirectTo },
    });

    // FALLBACK PRA 'recovery'. Basta ABRIR o link de convite uma vez pro
    // Supabase dar o e-mail por confirmado — e a partir daí ele recusa
    // `type: 'invite'` com "already been registered". Quem clicou e não
    // terminou de definir a senha (fechou a aba, caiu na tela errada, deixou
    // pra depois) ficava travado PARA SEMPRE: sem senha pra entrar e sem
    // convite pra gerar. O link de recovery leva pra mesma tela `/welcome`,
    // que já trata `type=recovery`.
    if (error && /already been registered/i.test(error.message ?? '')) {
      this.logger.log(
        `Convite de ${userScope.email} já foi aberto uma vez — gerando link de recovery`,
      );
      ({ data, error } = await this.supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: userScope.email,
        options: { redirectTo },
      }));
    }

    if (error || !data?.properties?.action_link) {
      throw new BusinessRuleException(
        `Falha ao reenviar convite: ${error?.message ?? 'sem action_link'}`,
      );
    }
    const inviteUrl = data.properties.action_link;

    // Busca o nome da empresa pra contexto do e-mail (best-effort)
    let empresaNome = 'sua empresa';
    try {
      const primeiraEmpresa = userScope.empresas[0]?.empresaId;
      if (primeiraEmpresa) {
        const emp = await this.prisma.empresa.findUnique({
          where: { id: primeiraEmpresa },
          select: { nome: true },
        });
        if (emp?.nome) empresaNome = emp.nome;
      }
    } catch {
      /* best-effort — usa fallback */
    }

    const sent = await this.email.enviarReenvioConvite({
      para: userScope.email,
      nome: userScope.nome,
      empresaNome,
      inviteUrl,
    });
    if (!sent.ok) {
      // A falha do e-mail era silenciosa (best-effort), e virar "sucesso" no
      // toast sem o user receber nada era catastrófico. Mas DERRUBAR a operação
      // também não serve: o link já foi gerado e é válido — jogá-lo fora deixa o
      // admin sem saída em tenant sem Resend configurado, que é o caso comum
      // antes do go-live. Agora o link VOLTA, com o motivo do e-mail não ter ido.
      const motivo = sent.motivo ?? 'motivo desconhecido';
      this.logger.warn(
        `Reenvio: link Supabase OK mas e-mail NÃO saiu pra ${userScope.email}: ${motivo} — ` +
          'link devolvido pro admin entregar por outro canal',
      );
      return {
        ok: true,
        sentTo: userScope.email,
        inviteUrl,
        emailEnviado: false,
        motivo: `E-mail não enviado (${motivo}). Entregue o link abaixo por outro canal.`,
      };
    }
    return { ok: true, sentTo: userScope.email, inviteUrl, emailEnviado: true };
  }

  /** Marca o usuário como ATIVO (chamado pelo onboarding após definir senha) */
  async confirmarOnboarding(id: string): Promise<void> {
    const user = await this.prisma.usuario.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário', id);
    if (user.status === 'ATIVO') return;
    await this.prisma.usuario.update({ where: { id }, data: { status: 'ATIVO' } });
    await this.invalidateAuthCache(id);
  }

  private async assertGerenteValido(gerenteId: string): Promise<void> {
    const g = await this.prisma.usuario.findUnique({
      where: { id: gerenteId },
      select: { role: true },
    });
    if (!g) throw new NotFoundException('Gerente', gerenteId);
    if (g.role !== 'GERENTE') {
      throw new BusinessRuleException('gerenteId precisa apontar pra um usuário com role=GERENTE');
    }
  }

  private serialize<T extends { empresas?: unknown[] }>(user: T): T {
    return user;
  }
}
