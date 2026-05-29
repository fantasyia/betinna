import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type {
  AssignRepDto,
  BulkAssignRepDto,
  BulkDeleteDto,
  BulkStatusDto,
  BulkTagsDto,
  CreateClienteDto,
  ListClientesDto,
  SetTagsDto,
  UpdateClienteDto,
  UpdateOmieStatusDto,
} from './clientes.dto';
import { ListasDinamicasService } from './listas-dinamicas.service';

const clienteInclude = {
  representante: {
    select: { id: true, nome: true, email: true, regiao: true },
  },
  tags: {
    include: { tag: true },
  },
  _count: {
    select: { pedidos: true, propostas: true, ocorrencias: true, amostras: true },
  },
} satisfies Prisma.ClienteInclude;

type ClienteWithRel = Prisma.ClienteGetPayload<{ include: typeof clienteInclude }>;

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listas: ListasDinamicasService,
    private readonly repScope: RepScopeService,
  ) {}

  // ─── Resolução do contexto de tenant + role ────────────────────────────
  /**
   * Monta o WHERE base que TODOS os métodos devem incluir.
   * - Filtra pela empresa ativa (multi-tenant)
   * - Se REP, filtra representanteId = user.id
   * - Se GERENTE, filtra representanteId IN (REPs sob sua gerência)
   * - ADMIN/DIRECTOR/SAC: sem filtro de carteira
   */
  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.ClienteWhereInput> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    const where: Prisma.ClienteWhereInput = { empresaId: user.empresaIdAtiva };
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) {
      where.representanteId = { in: scope };
    }
    return where;
  }

  // ─── Listagem com filtros + paginação ───────────────────────────────────
  async list(user: AuthenticatedUser, params: ListClientesDto): Promise<Paginated<ClienteWithRel>> {
    const where: Prisma.ClienteWhereInput = { ...(await this.baseWhere(user)) };
    const conditions: Prisma.ClienteWhereInput[] = [];

    if (params.search) {
      const term = params.search.trim();
      conditions.push({
        OR: [
          { nome: { contains: term, mode: 'insensitive' } },
          { cnpj: { contains: term } },
          { email: { contains: term, mode: 'insensitive' } },
          { codigoOmie: { contains: term } },
        ],
      });
    }
    if (params.segmento) conditions.push({ segmento: params.segmento });
    if (params.regiao) conditions.push({ regiao: params.regiao });
    if (params.status) conditions.push({ status: params.status });
    if (params.omieStatus) conditions.push({ omieStatus: params.omieStatus });
    if (params.representanteId) conditions.push({ representanteId: params.representanteId });
    if (params.tagId) conditions.push({ tags: { some: { tagId: params.tagId } } });

    const take = params.limit;
    const skip = (params.page - 1) * params.limit;
    const orderBy: Prisma.ClienteOrderByWithRelationInput = {
      [params.sortBy]: params.sortOrder,
    };

    // Lista dinâmica adiciona uma condição declarativa ao WHERE.
    if (params.lista) {
      conditions.push(this.listas.whereFor(params.lista));
    }

    if (conditions.length > 0) {
      where.AND = conditions;
    }

    const [total, data] = await Promise.all([
      this.prisma.cliente.count({ where }),
      this.prisma.cliente.findMany({
        where,
        skip,
        take,
        orderBy,
        include: clienteInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, take);
  }

  // ─── Detalhe ────────────────────────────────────────────────────────────
  async findById(user: AuthenticatedUser, id: string): Promise<ClienteWithRel> {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: clienteInclude,
    });
    if (!cliente) throw new NotFoundException('Cliente', id);
    return cliente;
  }

  // ─── Métricas de vendas ────────────────────────────────────────────────
  /**
   * Agregados de pedidos do cliente — usado pelo card de métricas na tela
   * do cliente. Conta apenas pedidos não-cancelados.
   *
   * - totalVendido: soma de `pedido.total` (todos os tempos)
   * - ticketMedio: média de `pedido.total`
   * - pedidosCount: contagem
   * - ultimoPedidoEm: data do mais recente (null se não tem)
   * - vendidoNoMes: soma do mês corrente
   * - pedidosNoMes: contagem do mês corrente
   */
  async metricas(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{
    totalVendido: number;
    ticketMedio: number;
    pedidosCount: number;
    ultimoPedidoEm: Date | null;
    vendidoNoMes: number;
    pedidosNoMes: number;
  }> {
    // Reaproveita findById só pra validar acesso (RBAC + scope GERENTE).
    await this.findById(user, id);

    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [agg, ultimo, mesAgg] = await Promise.all([
      this.prisma.pedido.aggregate({
        where: { clienteId: id, status: { not: 'CANCELADO' } },
        _sum: { total: true },
        _avg: { total: true },
        _count: { _all: true },
      }),
      this.prisma.pedido.findFirst({
        where: { clienteId: id, status: { not: 'CANCELADO' } },
        orderBy: { criadoEm: 'desc' },
        select: { criadoEm: true },
      }),
      this.prisma.pedido.aggregate({
        where: {
          clienteId: id,
          status: { not: 'CANCELADO' },
          criadoEm: { gte: inicioMes },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
    ]);

    return {
      totalVendido: agg._sum.total ?? 0,
      ticketMedio: agg._avg.total ?? 0,
      pedidosCount: agg._count._all,
      ultimoPedidoEm: ultimo?.criadoEm ?? null,
      vendidoNoMes: mesAgg._sum.total ?? 0,
      pedidosNoMes: mesAgg._count._all,
    };
  }

  // ─── Criar ──────────────────────────────────────────────────────────────
  async create(user: AuthenticatedUser, dto: CreateClienteDto): Promise<ClienteWithRel> {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }

    // Garante que o representanteId (se informado) pertença à mesma empresa
    if (dto.representanteId) {
      await this.assertRepValido(user.empresaIdAtiva, dto.representanteId);
    } else if (user.role === 'REP') {
      // Rep criando: atribui automaticamente a si mesmo
      dto.representanteId = user.id;
    }

    if (dto.cnpj) await this.assertCnpjUnico(user.empresaIdAtiva, dto.cnpj);
    if (dto.codigoOmie) await this.assertCodigoOmieUnico(user.empresaIdAtiva, dto.codigoOmie);
    if (dto.tagIds && dto.tagIds.length > 0) {
      await this.assertTagsValidas(user.empresaIdAtiva, dto.tagIds);
    }

    const { tagIds, ...rest } = dto;
    return this.prisma.cliente.create({
      data: {
        ...rest,
        empresaId: user.empresaIdAtiva,
        tags: tagIds ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
      include: clienteInclude,
    });
  }

  // ─── Atualizar ──────────────────────────────────────────────────────────
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateClienteDto,
  ): Promise<ClienteWithRel> {
    const existing = await this.findById(user, id);

    if (dto.representanteId !== undefined && dto.representanteId !== existing.representanteId) {
      // Auditoria 2026-05-15, P0-3: REP não pode transferir cliente pra outro REP.
      // Mudança de representanteId é função gerencial.
      if (user.role === 'REP') {
        throw new ForbiddenException(
          'REP não pode alterar o representante do cliente — apenas ADMIN/DIRECTOR/GERENTE',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
      if (dto.representanteId) {
        await this.assertRepValido(existing.empresaId, dto.representanteId);
      }
    }
    if (dto.cnpj && dto.cnpj !== existing.cnpj) {
      await this.assertCnpjUnico(existing.empresaId, dto.cnpj);
    }
    if (dto.codigoOmie && dto.codigoOmie !== existing.codigoOmie) {
      await this.assertCodigoOmieUnico(existing.empresaId, dto.codigoOmie);
    }
    if (dto.tagIds) await this.assertTagsValidas(existing.empresaId, dto.tagIds);

    const { tagIds, ...rest } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (tagIds) {
        await tx.clienteTag.deleteMany({ where: { clienteId: id } });
        if (tagIds.length > 0) {
          await tx.clienteTag.createMany({
            data: tagIds.map((tagId) => ({ clienteId: id, tagId })),
          });
        }
      }
      await tx.cliente.updateMany({
        where: { id, empresaId: existing.empresaId },
        data: rest,
      });
      return tx.cliente.findUniqueOrThrow({ where: { id }, include: clienteInclude });
    });
  }

  // ─── Atribuir representante ─────────────────────────────────────────────
  async assignRep(user: AuthenticatedUser, id: string, dto: AssignRepDto): Promise<ClienteWithRel> {
    // findById já filtra por baseWhere (empresa + scope GERENTE)
    const existing = await this.findById(user, id);

    if (dto.representanteId) {
      await this.assertRepValido(user.empresaIdAtiva!, dto.representanteId);

      // GERENTE só pode transferir pra reps sob sua gerência
      const scope = await this.repScope.getRepIds(user);
      if (scope !== null && !scope.includes(dto.representanteId)) {
        throw new ForbiddenException(
          'O representante de destino não está sob sua gerência',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
    }
    await this.prisma.cliente.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { representanteId: dto.representanteId },
    });
    return this.prisma.cliente.findUniqueOrThrow({ where: { id }, include: clienteInclude });
  }

  async bulkAssignRep(
    user: AuthenticatedUser,
    dto: BulkAssignRepDto,
  ): Promise<{ ok: true; afetados: number }> {
    // Controller (@Roles) já bloqueou REP. Aqui aplicamos scope GERENTE
    // para impedir gerente de uma equipe reatribuir clientes de outra.
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    const empresaId = user.empresaIdAtiva;

    // Validação do destino: rep deve estar na mesma empresa
    if (dto.representanteId) {
      await this.assertRepValido(empresaId, dto.representanteId);
    }

    // Para GERENTE, o destino também precisa estar sob sua gerência
    // (ADMIN/DIRECTOR podem atribuir a qualquer rep da empresa).
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null && dto.representanteId) {
      if (!scope.includes(dto.representanteId)) {
        throw new ForbiddenException(
          'O representante de destino não está sob sua gerência',
          ErrorCode.TENANT_ACCESS_DENIED,
        );
      }
    }

    // O UPDATE filtra:
    //  - empresaId = empresa ativa (always)
    //  - id IN clienteIds informados
    //  - representanteId atual IN scope (quando GERENTE) — impede reatribuir
    //    clientes de outros gerentes/diretor
    const where: Prisma.ClienteWhereInput = {
      id: { in: dto.clienteIds },
      empresaId,
    };
    if (scope !== null) {
      // GERENTE só mexe em clientes cujo rep atual está em sua carteira
      where.representanteId = { in: scope };
    }

    const { count } = await this.prisma.cliente.updateMany({
      where,
      data: { representanteId: dto.representanteId },
    });

    return { ok: true, afetados: count };
  }

  // ─── CL1 (Lote 7) — Ações em massa: tag, status, exclusão ───────────────

  /**
   * Resolve quais dos clienteIds informados o usuário pode mexer
   * (empresa ativa + escopo de carteira do GERENTE/REP). Evita que um gerente
   * altere clientes de outra equipe passando IDs arbitrários.
   */
  private async idsAcessiveis(user: AuthenticatedUser, clienteIds: string[]): Promise<string[]> {
    const base = await this.baseWhere(user);
    const rows = await this.prisma.cliente.findMany({
      where: { ...base, id: { in: clienteIds } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Aplica ou remove tags em vários clientes de uma vez. */
  async bulkSetTags(
    user: AuthenticatedUser,
    dto: BulkTagsDto,
  ): Promise<{ ok: true; afetados: number }> {
    const empresaId = this.requireEmpresa(user);
    await this.assertTagsValidas(empresaId, dto.tagIds);

    const ids = await this.idsAcessiveis(user, dto.clienteIds);
    if (ids.length === 0) return { ok: true, afetados: 0 };

    if (dto.modo === 'adicionar') {
      await this.prisma.clienteTag.createMany({
        data: ids.flatMap((clienteId) => dto.tagIds.map((tagId) => ({ clienteId, tagId }))),
        skipDuplicates: true,
      });
    } else {
      await this.prisma.clienteTag.deleteMany({
        where: { clienteId: { in: ids }, tagId: { in: dto.tagIds } },
      });
    }
    return { ok: true, afetados: ids.length };
  }

  /** Muda o status de vários clientes de uma vez. */
  async bulkUpdateStatus(
    user: AuthenticatedUser,
    dto: BulkStatusDto,
  ): Promise<{ ok: true; afetados: number }> {
    const base = await this.baseWhere(user);
    const { count } = await this.prisma.cliente.updateMany({
      where: { ...base, id: { in: dto.clienteIds } },
      data: { status: dto.status },
    });
    return { ok: true, afetados: count };
  }

  /**
   * Exclui vários clientes (best-effort). Cada cliente passa pelo remove()
   * individual, que valida escopo e bloqueia exclusão de quem tem pedidos/
   * propostas. Retorna quantos saíram e a lista de falhas com o motivo.
   */
  async bulkRemove(
    user: AuthenticatedUser,
    dto: BulkDeleteDto,
  ): Promise<{ ok: true; excluidos: number; falhas: Array<{ id: string; erro: string }> }> {
    const falhas: Array<{ id: string; erro: string }> = [];
    let excluidos = 0;
    for (const id of dto.clienteIds) {
      try {
        await this.remove(user, id);
        excluidos += 1;
      } catch (err) {
        falhas.push({ id, erro: err instanceof Error ? err.message : String(err) });
      }
    }
    return { ok: true, excluidos, falhas };
  }

  // ─── Tags ───────────────────────────────────────────────────────────────
  async setTags(user: AuthenticatedUser, id: string, dto: SetTagsDto): Promise<ClienteWithRel> {
    const existing = await this.findById(user, id);
    if (dto.tagIds.length > 0) {
      await this.assertTagsValidas(existing.empresaId, dto.tagIds);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.clienteTag.deleteMany({ where: { clienteId: id } });
      if (dto.tagIds.length > 0) {
        await tx.clienteTag.createMany({
          data: dto.tagIds.map((tagId) => ({ clienteId: id, tagId })),
        });
      }
      return tx.cliente.findUniqueOrThrow({ where: { id }, include: clienteInclude });
    });
  }

  // ─── Status OMIE (recebido do webhook do OMIE, manual via admin) ───────
  async updateOmieStatus(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateOmieStatusDto,
  ): Promise<ClienteWithRel> {
    const existing = await this.findById(user, id);
    await this.prisma.cliente.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { omieStatus: dto.omieStatus },
    });
    return this.prisma.cliente.findUniqueOrThrow({ where: { id }, include: clienteInclude });
  }

  // ─── Remoção ────────────────────────────────────────────────────────────
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    // FK em pedidos/propostas usa onDelete default (RESTRICT). Lance erro claro.
    try {
      await this.prisma.cliente.deleteMany({ where: { id, empresaId: existing.empresaId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BusinessRuleException(
          'Cliente possui pedidos, propostas ou outros vínculos. Inative o cliente em vez de excluir.',
        );
      }
      throw err;
    }
  }

  // ─── Helpers privados ───────────────────────────────────────────────────
  private async assertCnpjUnico(empresaId: string, cnpj: string): Promise<void> {
    const existe = await this.prisma.cliente.findFirst({
      where: { empresaId, cnpj },
      select: { id: true },
    });
    if (existe) {
      throw new BusinessRuleException(
        `Já existe cliente com CNPJ ${cnpj} nesta empresa`,
        ErrorCode.ALREADY_EXISTS,
      );
    }
  }

  private async assertCodigoOmieUnico(empresaId: string, codigoOmie: string): Promise<void> {
    const existe = await this.prisma.cliente.findUnique({
      where: { empresaId_codigoOmie: { empresaId, codigoOmie } },
      select: { id: true },
    });
    if (existe) {
      throw new BusinessRuleException(
        `Já existe cliente com código OMIE ${codigoOmie} nesta empresa`,
        ErrorCode.ALREADY_EXISTS,
      );
    }
  }

  private async assertRepValido(empresaId: string, repId: string): Promise<void> {
    const rep = await this.prisma.usuario.findFirst({
      where: {
        id: repId,
        role: 'REP',
        status: 'ATIVO',
        empresas: { some: { empresaId } },
      },
      select: { id: true },
    });
    if (!rep) {
      throw new BusinessRuleException(
        'Representante inválido, inativo ou não vinculado a esta empresa',
      );
    }
  }

  /**
   * Valida que as tags existem E pertencem à empresa do user.
   * Auditoria 2026-05-15: tags agora têm `empresaId` — não pode misturar
   * tags entre tenants.
   */
  private async assertTagsValidas(empresaId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return;
    const count = await this.prisma.tag.count({
      where: { id: { in: tagIds }, empresaId },
    });
    if (count !== tagIds.length) {
      throw new BusinessRuleException('Uma ou mais tags não existem');
    }
  }
}
