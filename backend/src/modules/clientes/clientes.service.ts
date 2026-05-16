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
    if (params.scoreMin !== undefined) conditions.push({ score: { gte: params.scoreMin } });
    if (params.scoreMax !== undefined) conditions.push({ score: { lte: params.scoreMax } });

    // Lista dinâmica adiciona uma condição declarativa (exceto top10 que é orderBy+take)
    let take = params.limit;
    let skip = (params.page - 1) * params.limit;
    let orderBy: Prisma.ClienteOrderByWithRelationInput | Prisma.ClienteOrderByWithRelationInput[] =
      { [params.sortBy]: params.sortOrder };

    if (params.lista) {
      if (params.lista === 'top10') {
        // Top 10 por score (proxy de ticket até termos tabela de pedidos com fatura real)
        orderBy = [{ score: 'desc' }, { criadoEm: 'desc' }];
        take = Math.min(params.limit, 10);
        skip = 0;
      } else {
        conditions.push(this.listas.whereFor(params.lista));
      }
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
    if (dto.codigoOmie) await this.assertCodigoOmieUnico(dto.codigoOmie);
    if (dto.tagIds && dto.tagIds.length > 0) {
      await this.assertTagsValidas(user.empresaIdAtiva, dto.tagIds);
    }

    const { tagIds, ...rest } = dto;
    return this.prisma.cliente.create({
      data: {
        ...rest,
        empresaId: user.empresaIdAtiva,
        tags: tagIds
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
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
      await this.assertCodigoOmieUnico(dto.codigoOmie);
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
      return tx.cliente.update({
        where: { id },
        data: rest,
        include: clienteInclude,
      });
    });
  }

  // ─── Atribuir representante ─────────────────────────────────────────────
  async assignRep(
    user: AuthenticatedUser,
    id: string,
    dto: AssignRepDto,
  ): Promise<ClienteWithRel> {
    // findById já filtra por baseWhere (empresa + scope GERENTE)
    await this.findById(user, id);

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
    return this.prisma.cliente.update({
      where: { id },
      data: { representanteId: dto.representanteId },
      include: clienteInclude,
    });
  }

  async bulkAssignRep(
    user: AuthenticatedUser,
    dto: BulkAssignRepDto,
  ): Promise<{ ok: true; afetados: number }> {
    // Controller (@Roles) já bloqueou REP. Aqui aplicamos scope GERENTE
    // para impedir gerente de uma equipe reatribuir clientes de outra.
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
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

  // ─── Tags ───────────────────────────────────────────────────────────────
  async setTags(
    user: AuthenticatedUser,
    id: string,
    dto: SetTagsDto,
  ): Promise<ClienteWithRel> {
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
    await this.findById(user, id);
    return this.prisma.cliente.update({
      where: { id },
      data: { omieStatus: dto.omieStatus },
      include: clienteInclude,
    });
  }

  // ─── Remoção ────────────────────────────────────────────────────────────
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    await this.findById(user, id);
    // FK em pedidos/propostas usa onDelete default (RESTRICT). Lance erro claro.
    try {
      await this.prisma.cliente.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
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

  private async assertCodigoOmieUnico(codigoOmie: string): Promise<void> {
    const existe = await this.prisma.cliente.findUnique({
      where: { codigoOmie },
      select: { id: true },
    });
    if (existe) {
      throw new BusinessRuleException(
        `Já existe cliente com código OMIE ${codigoOmie}`,
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
