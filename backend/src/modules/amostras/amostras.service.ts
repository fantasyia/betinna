import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import {
  OmieAmostrasService,
  type OmieAmostraEnvioResult,
} from '@integrations/omie/omie-amostras.service';
import { ForbiddenException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import type {
  ChangeAmostraStatusDto,
  CreateAmostraDto,
  ListAmostrasDto,
  UpdateAmostraDto,
} from './amostras.dto';

const amostraInclude = {
  cliente: { select: { id: true, nome: true, cnpj: true } },
  produto: { select: { id: true, nome: true, codigoOmie: true, sku: true, unidade: true } },
} satisfies Prisma.AmostraInclude;

type AmostraWithRel = Prisma.AmostraGetPayload<{ include: typeof amostraInclude }>;

/**
 * Amostras enviadas a prospects/clientes.
 *
 * Fluxo:
 *  1. Rep solicita amostra → ENVIADA
 *  2. Após X dias → AGUARDANDO_FOLLOWUP
 *  3. Rep marca como CONVERTIDA (virou pedido) ou NAO_CONVERTEU
 *  4. Se passar 30d sem decisão → VENCIDA (job futuro pode automatizar)
 */
@Injectable()
export class AmostrasService {
  private readonly logger = new Logger(AmostrasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repScope: RepScopeService,
    private readonly omieAmostras: OmieAmostrasService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.AmostraWhereInput> {
    const where: Prisma.AmostraWhereInput = { empresaId: this.requireEmpresa(user) };
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) {
      where.cliente = { representanteId: { in: scope } };
    }
    return where;
  }

  async list(user: AuthenticatedUser, params: ListAmostrasDto): Promise<Paginated<AmostraWithRel>> {
    const where: Prisma.AmostraWhereInput = { ...(await this.baseWhere(user)) };
    const conds: Prisma.AmostraWhereInput[] = [];
    if (params.status) conds.push({ status: params.status });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.vencidas) {
      conds.push({
        followUpEm: { lte: new Date() },
        status: { in: ['ENVIADA', 'AGUARDANDO_FOLLOWUP'] },
      });
    }
    if (conds.length > 0) where.AND = conds;

    const [total, data] = await Promise.all([
      this.prisma.amostra.count({ where }),
      this.prisma.amostra.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { [params.sortBy]: params.sortOrder },
        include: amostraInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<AmostraWithRel> {
    const amostra = await this.prisma.amostra.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: amostraInclude,
    });
    if (!amostra) throw new NotFoundException('Amostra', id);
    return amostra;
  }

  async create(user: AuthenticatedUser, dto: CreateAmostraDto): Promise<AmostraWithRel> {
    const empresaId = this.requireEmpresa(user);
    // valida que o cliente pertence à empresa e (se rep) à carteira
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, empresaId },
      select: { id: true, representanteId: true },
    });
    if (!cliente) throw new NotFoundException('Cliente', dto.clienteId);
    const scope = await this.repScope.getRepIds(user);
    if (
      scope !== null &&
      (cliente.representanteId === null || !scope.includes(cliente.representanteId))
    ) {
      throw new ForbiddenException('Cliente não pertence à sua carteira');
    }

    // P7 — se vincular produto do catálogo, valida que pertence à empresa.
    if (dto.produtoId) {
      const produto = await this.prisma.produto.findFirst({
        where: { id: dto.produtoId, empresaId },
        select: { id: true },
      });
      if (!produto) throw new NotFoundException('Produto', dto.produtoId);
    }

    const enviadoEm = dto.enviadoEm ?? new Date();
    const followUpEm = new Date(enviadoEm.getTime() + dto.diasFollowUp * 24 * 60 * 60 * 1000);

    return this.prisma.amostra.create({
      data: {
        empresaId,
        clienteId: dto.clienteId,
        produtoNome: dto.produtoNome,
        produtoId: dto.produtoId,
        quantidade: dto.quantidade,
        valor: dto.valor,
        notaFiscal: dto.notaFiscal,
        enviadoEm,
        followUpEm,
        status: 'ENVIADA',
        representanteNome: dto.representanteNome ?? (user.role === 'REP' ? user.nome : undefined),
      },
      include: amostraInclude,
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAmostraDto,
  ): Promise<AmostraWithRel> {
    const existing = await this.findById(user, id);
    // P7 — valida vínculo de produto (quando trocado) contra o tenant.
    if (dto.produtoId) {
      const produto = await this.prisma.produto.findFirst({
        where: { id: dto.produtoId, empresaId: existing.empresaId },
        select: { id: true },
      });
      if (!produto) throw new NotFoundException('Produto', dto.produtoId);
    }
    await this.prisma.amostra.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    return this.prisma.amostra.findUniqueOrThrow({ where: { id }, include: amostraInclude });
  }

  async changeStatus(
    user: AuthenticatedUser,
    id: string,
    dto: ChangeAmostraStatusDto,
  ): Promise<AmostraWithRel> {
    const existing = await this.findById(user, id);
    await this.prisma.amostra.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: { status: dto.status },
    });
    return this.prisma.amostra.findUniqueOrThrow({ where: { id }, include: amostraInclude });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findById(user, id);
    await this.prisma.amostra.deleteMany({ where: { id, empresaId: existing.empresaId } });
  }

  /**
   * P7 — Envia a amostra como remessa de amostra grátis pro OMIE.
   *
   * findById valida tenant + carteira do rep. As pré-condições fiscais
   * (produto vinculado com codigoOmie, cliente ATIVO com codigoOmie, etc.)
   * ficam no OmieAmostrasService, que também persiste numeroOmie/enviadoOmieEm/cfop.
   */
  async enviarParaOmie(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ amostra: AmostraWithRel; omie: OmieAmostraEnvioResult }> {
    const amostra = await this.findById(user, id);
    const omie = await this.omieAmostras.enviarAmostra(id, amostra.empresaId);
    const atualizada = await this.findById(user, id);
    return { amostra: atualizada, omie };
  }
}
