import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { MarcaTenantService } from './marca-tenant.service';
import { RedisService } from '@database/redis.service';
import { AuthGuard } from '@modules/auth/guards/auth.guard';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { buildPaginated, type Paginated } from '@shared/types/pagination';
import { KnowledgeConfigService } from '@modules/rag/knowledge-config.service';
import { EvolutionInstanciaService } from '@integrations/evolution/evolution-instancia.service';
import {
  type EnvioWhatsappConfig,
  INBOUND_RECENTE_HORAS,
  type JanelaEnvioConfig,
  type TetoDiarioConfig,
  resolveEnvioWhatsapp,
  resolveJanelaEnvio,
  resolveTetoDiario,
} from '@shared/whatsapp-pacing/whatsapp-pacing.util';
import type {
  CreateEmpresaDto,
  ListEmpresasDto,
  TenantConfigPatchDto,
  UpdateEmpresaDto,
} from './empresas.dto';

@Injectable()
export class EmpresasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeConfig: KnowledgeConfigService,
    private readonly evolutionInstancias: EvolutionInstanciaService,
    private readonly redis: RedisService,
    private readonly marca: MarcaTenantService,
  ) {}

  /**
   * Derruba o cache de auth de todos os usuários do tenant. O AuthGuard só
   * enxerga vínculos de empresa ATIVA, mas o cache (TTL) manteria a sessão
   * operando no tenant recém-desativado até expirar — aqui a mudança vale já.
   */
  private async invalidarSessoesDoTenant(empresaId: string): Promise<void> {
    const vinculos = await this.prisma.usuarioEmpresa.findMany({
      where: { empresaId },
      select: { usuarioId: true },
    });
    await Promise.all(
      vinculos.map((v) => AuthGuard.invalidate(this.redis, v.usuarioId).catch(() => undefined)),
    );
  }

  /**
   * Lista as empresas que o usuário autenticado pode ACESSAR.
   *
   * - ADMIN: cross-tenant — retorna TODAS as empresas ativas do sistema.
   *   (Master da plataforma, pode operar como suporte em qualquer tenant.)
   * - Demais papéis: apenas as empresas vinculadas via UsuarioEmpresa.
   *
   * Usado pelo `EmpresaSwitcher` na sidebar do frontend pra trocar de
   * tenant ativo via header `X-Empresa-Id`.
   */
  async listMine(
    user: AuthenticatedUser,
  ): Promise<Array<{ id: string; nome: string; logoUrl: string | null }>> {
    if (user.role === 'ADMIN') {
      // ADMIN cross-tenant: vê TODAS as empresas ativas
      return this.prisma.empresa.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, logoUrl: true },
      });
    }
    // Demais: apenas as vinculadas via UsuarioEmpresa
    const vinculos = await this.prisma.usuarioEmpresa.findMany({
      where: { usuarioId: user.id, empresa: { ativo: true } },
      orderBy: { empresa: { nome: 'asc' } },
      select: {
        empresa: { select: { id: true, nome: true, logoUrl: true } },
      },
    });
    return vinculos.map((v) => v.empresa);
  }

  /**
   * Retorna a empresa ATIVA do usuário (header X-Empresa-Id → empresaIdAtiva).
   * Inclui campos de config (desconto à vista) usados no preview de pedido/proposta.
   * Acessível por qualquer usuário autenticado (só lê config da própria empresa ativa).
   */
  async empresaAtual(user: AuthenticatedUser) {
    if (!user.empresaIdAtiva) {
      throw new NotFoundException('Empresa ativa', 'nenhuma');
    }
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: user.empresaIdAtiva },
      select: {
        id: true,
        nome: true,
        descontoPixPct: true,
        descontoBoletoAvistaPct: true,
        botWhatsappAtivo: true,
        config: true,
      },
    });
    if (!empresa) throw new NotFoundException('Empresa', user.empresaIdAtiva);
    return empresa;
  }

  // ─── ConfiguracaoTenant (no-code Admin Panel) ─────────────────────────

  /** Config (JSON) da empresa ativa; {} quando ainda não configurada. */
  async getConfig(user: AuthenticatedUser): Promise<Record<string, unknown>> {
    if (!user.empresaIdAtiva) throw new NotFoundException('Empresa ativa', 'nenhuma');
    const emp = await this.prisma.empresa.findUnique({
      where: { id: user.empresaIdAtiva },
      select: { config: true },
    });
    return (emp?.config as Record<string, unknown> | null) ?? {};
  }

  /**
   * Regras de envio de WhatsApp já RESOLVIDAS — o que o motor de fato aplica,
   * não o que está gravado.
   *
   * Existe porque a tela precisa dizer a verdade sobre o runtime. `getConfig`
   * devolve o JSON cru: numa empresa que nunca salvou, `envioWhatsapp` vem
   * vazio, e quem lê teria que reimplementar os defaults e as correções (janela
   * invertida, lista de dias vazia) pra saber o que acontece de verdade. Duas
   * implementações da mesma regra divergem no dia em que alguém corrige uma —
   * que é exatamente o defeito do rótulo do PAUSAR_IA, de novo.
   *
   * Aqui passa pelas MESMAS funções que o `WhatsappPacingService` usa.
   */
  async getEnvioWhatsappEfetivo(user: AuthenticatedUser): Promise<{
    envio: EnvioWhatsappConfig;
    janela: JanelaEnvioConfig;
    tetoDiario: TetoDiarioConfig;
    /** Horas desde a última mensagem do lead em que o envio ainda conta como resposta. */
    conversaVivaHoras: number;
  }> {
    const cfg = await this.getConfig(user);
    const raw = (cfg as { envioWhatsapp?: { janela?: unknown; tetoDiario?: unknown } })
      .envioWhatsapp;
    return {
      envio: resolveEnvioWhatsapp(raw),
      janela: resolveJanelaEnvio(raw?.janela),
      tetoDiario: resolveTetoDiario(raw?.tetoDiario),
      conversaVivaHoras: INBOUND_RECENTE_HORAS,
    };
  }

  /**
   * Merge de 1 NÍVEL do patch na config. CAÇADA-BUG #53: vários sub-schemas do config são `.partial()`,
   * então um PATCH parcial (ex.: `envioWhatsapp: { maxPorMinuto: 10 }`) com merge raso substituía o
   * sub-objeto INTEIRO e apagava as chaves-irmãs já salvas (jitterMinSeg, etc). Agora, quando a chave é
   * objeto simples nos DOIS lados, funde 1 nível (preserva as irmãs); arrays/escalares substituem.
   *
   * REVISÃO #R4: com o merge, `undefined` some do JSON e uma chave omitida é PRESERVADA — então o front
   * não conseguia LIMPAR um campo pro default (salvar virava no-op). Convenção: `null` EXPLÍCITO = remover.
   * `{ emailTransacional: { fromNome: null } }` apaga só o fromNome (preserva replyTo); `{ x: null }` no
   * topo remove a seção inteira. As folhas "limpáveis" no DTO são `.nullable()` pra o null passar no zod.
   */
  async patchConfig(
    user: AuthenticatedUser,
    patch: TenantConfigPatchDto,
  ): Promise<Record<string, unknown>> {
    if (!user.empresaIdAtiva) throw new NotFoundException('Empresa ativa', 'nenhuma');
    const empresaId = user.empresaIdAtiva;
    // Atômico: read-modify-write do JSON sob lock pessimista da linha (FOR UPDATE) —
    // sem isto, 2 PATCH concorrentes (2 seções do Avançado salvas juntas) leem o mesmo
    // `atual` e o último a gravar apaga a sub-chave do outro (lost update).
    const proximo = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ config: unknown }>>`
        SELECT "config" FROM "Empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
      const atual = (rows[0]?.config as Record<string, unknown> | null) ?? {};
      const ehObjetoSimples = (x: unknown): x is Record<string, unknown> =>
        typeof x === 'object' && x !== null && !Array.isArray(x);
      const merged: Record<string, unknown> = { ...atual };
      for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        // #R4 — null no topo = remover a seção inteira (volta ao default).
        if (v === null) {
          delete merged[k];
          continue;
        }
        const cur = atual[k];
        if (ehObjetoSimples(cur) && ehObjetoSimples(v)) {
          // Funde 1 nível preservando as irmãs (#53); null numa sub-chave a REMOVE (#R4).
          const sub: Record<string, unknown> = { ...cur };
          for (const [sk, sv] of Object.entries(v)) {
            if (sv === null) delete sub[sk];
            else sub[sk] = sv;
          }
          merged[k] = sub;
        } else {
          merged[k] = v;
        }
      }
      await tx.empresa.update({
        where: { id: empresaId },
        data: { config: merged as Prisma.InputJsonValue },
      });
      return merged;
    });
    // A marca fica em cache 10min pros PDFs; sem invalidar, trocar a cor e
    // gerar o documento na sequência sairia com a cor velha — e ninguém
    // desconfia do cache, desconfia do salvar.
    this.marca.invalidar(empresaId);
    // RAG — regenera os chunks de conhecimento derivados da config (best-effort,
    // não derruba o salvar se a indexação falhar).
    await this.knowledgeConfig.sincronizar(empresaId).catch(() => undefined);
    return proximo;
  }

  async list(
    params: ListEmpresasDto,
  ): Promise<Paginated<Awaited<ReturnType<typeof this.findById>>>> {
    const where = {
      ...(params.search
        ? {
            OR: [
              { nome: { contains: params.search, mode: 'insensitive' as const } },
              { cnpj: { contains: params.search } },
            ],
          }
        : {}),
      ...(params.ativo !== undefined ? { ativo: params.ativo } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.empresa.count({ where }),
      this.prisma.empresa.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { criadoEm: 'desc' },
        include: { _count: { select: { usuarios: true, clientes: true } } },
      }),
    ]);

    return buildPaginated(items, total, params.page, params.limit);
  }

  async findById(id: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true, clientes: true } } },
    });
    if (!empresa) throw new NotFoundException('Empresa', id);
    return empresa;
  }

  async create(dto: CreateEmpresaDto) {
    return this.prisma.empresa.create({
      data: { ...dto, ativo: true },
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateEmpresaDto) {
    this.assertCanManageEmpresa(user, id);
    await this.findById(id); // garante existência
    return this.prisma.empresa.update({ where: { id }, data: dto });
  }

  async deactivate(user: AuthenticatedUser, id: string) {
    this.assertCanManageEmpresa(user, id);
    await this.findById(id);
    const atualizada = await this.prisma.empresa.update({ where: { id }, data: { ativo: false } });
    // Cleanup on-deactivation: desconecta + deleta a instância WhatsApp central no Evolution
    // (best-effort, fire-and-forget).
    void this.evolutionInstancias.desativar({ type: 'EMPRESA', id });
    await this.invalidarSessoesDoTenant(id);
    return atualizada;
  }

  async activate(user: AuthenticatedUser, id: string) {
    this.assertCanManageEmpresa(user, id);
    await this.findById(id);
    const atualizada = await this.prisma.empresa.update({
      where: { id },
      data: { ativo: true },
    });
    // Reativar também precisa derrubar o cache — senão os vínculos ficam de fora
    // até o TTL expirar e o pessoal do tenant segue sem acesso.
    await this.invalidarSessoesDoTenant(id);
    return atualizada;
  }

  /**
   * Gate de vínculo (multi-tenant): só ADMIN (master da plataforma, cross-tenant
   * por D48) ou DIRECTOR da PRÓPRIA empresa pode alterar/ativar/desativar.
   *
   * Sem isto, os endpoints `@Patch/@Delete/@Put ativar` checavam só o PAPEL —
   * um DIRECTOR (papel de cliente) conseguia editar/desativar a empresa de outro
   * tenant via request direto à API. Mesma checagem de `assertCanManageLogo`.
   */
  private assertCanManageEmpresa(user: AuthenticatedUser, empresaId: string): void {
    if (user.role === 'ADMIN') return;
    if (user.role === 'DIRECTOR' && user.empresaIds.includes(empresaId)) return;
    throw new ForbiddenException(
      'Você só pode alterar a sua própria empresa.',
      ErrorCode.TENANT_ACCESS_DENIED,
    );
  }
}
