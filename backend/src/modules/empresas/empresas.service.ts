import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { buildPaginated, type Paginated } from '@shared/types/pagination';
import { KnowledgeConfigService } from '@modules/rag/knowledge-config.service';
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
  ) {}

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

  /** Merge raso (top-level) do patch na config — o front manda sub-objetos completos. */
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
      const merged = { ...atual, ...patch };
      await tx.empresa.update({
        where: { id: empresaId },
        data: { config: merged as Prisma.InputJsonValue },
      });
      return merged;
    });
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
    return this.prisma.empresa.update({ where: { id }, data: { ativo: false } });
  }

  async activate(user: AuthenticatedUser, id: string) {
    this.assertCanManageEmpresa(user, id);
    await this.findById(id);
    return this.prisma.empresa.update({ where: { id }, data: { ativo: true } });
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
