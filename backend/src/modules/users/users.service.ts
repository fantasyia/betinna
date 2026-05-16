import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type UserRole } from '@prisma/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
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
  ) {
    this.supabaseAdmin = createClient(
      this.env.get('SUPABASE_URL'),
      this.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
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
        throw new ForbiddenException(
          'Empresa não definida',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
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
      ...(empresaIdFiltro
        ? { empresas: { some: { empresaId: empresaIdFiltro } } }
        : {}),
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

  async findById(caller: AuthenticatedUser, id: string) {
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
        throw new ForbiddenException(
          'Empresa não definida',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      const compartilham = target.empresas.some((e) => e.empresaId === callerEmpresa);
      if (!compartilham) {
        // Não vaza existência cross-tenant
        throw new NotFoundException('Usuário', id);
      }
    }

    return this.serialize(target);
  }

  async create(dto: CreateUserDto) {
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

    // 3) Cria no Supabase Auth (envia convite por e-mail)
    const redirectTo = `${this.env.get('SUPABASE_URL').replace('.supabase.co', '.app')}/welcome`;
    const { data: authData, error } = await this.supabaseAdmin.auth.admin.inviteUserByEmail(
      dto.email,
      { data: { nome: dto.nome, role: dto.role }, redirectTo },
    );
    if (error || !authData.user) {
      throw new BusinessRuleException(
        `Falha ao criar usuário no Supabase: ${error?.message ?? 'erro desconhecido'}`,
      );
    }

    // Validação: gerenteId deve apontar pra um usuário com role=GERENTE
    if (dto.gerenteId) {
      await this.assertGerenteValido(dto.gerenteId);
    }

    // 4) Cria registro no nosso banco
    const created = await this.prisma.usuario.create({
      data: {
        id: authData.user.id,
        email: dto.email,
        nome: dto.nome,
        telefone: dto.telefone,
        role: dto.role,
        status: 'PENDENTE',
        regiao: dto.regiao,
        tetoDesconto: dto.tetoDesconto ?? (dto.role === 'REP' ? 5 : null),
        comissaoPadrao: dto.comissaoPadrao ?? (dto.role === 'REP' ? 5 : null),
        gerenteId: dto.role === 'REP' ? dto.gerenteId ?? null : null,
        empresas: {
          create: dto.empresaIds.map((empresaId) => ({ empresaId })),
        },
      },
      include: {
        empresas: { include: { empresa: { select: { id: true, nome: true } } } },
      },
    });
    this.logger.log(`Usuário criado: ${created.email} (${created.role})`);
    return this.serialize(created);
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
    if (gerenteId !== undefined) dataPatch.gerente = gerenteId
      ? { connect: { id: gerenteId } }
      : { disconnect: true };
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
    return updated;
  }

  async setRepDiscountLimit(
    caller: AuthenticatedUser,
    id: string,
    dto: UpdateRepDiscountLimitDto,
  ): Promise<void> {
    const user = await this.loadAndAssertScope(caller, id);
    if (user.role !== 'REP') {
      throw new BusinessRuleException(
        'Apenas representantes têm teto de desconto configurável',
      );
    }
    await this.prisma.usuario.update({
      where: { id },
      data: { tetoDesconto: dto.tetoDesconto },
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
      throw new BusinessRuleException(
        'Comissão configurável apenas para REP ou GERENTE',
      );
    }
    await this.prisma.usuario.update({
      where: { id },
      data: { comissaoPadrao: dto.comissaoPadrao },
    });
  }

  async resendInvite(
    caller: AuthenticatedUser,
    id: string,
  ): Promise<{ ok: true; sentTo: string }> {
    const user = await this.loadAndAssertScope(caller, id);
    if (user.status !== 'PENDENTE') {
      throw new BusinessRuleException('Usuário não está com convite pendente');
    }
    const { error } = await this.supabaseAdmin.auth.admin.inviteUserByEmail(user.email);
    if (error) {
      throw new BusinessRuleException(`Falha ao reenviar convite: ${error.message}`);
    }
    return { ok: true, sentTo: user.email };
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
