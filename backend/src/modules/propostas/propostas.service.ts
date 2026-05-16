import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { PricingService } from '@modules/produtos/pricing.service';
import { PedidoPricingService } from '@modules/pedidos/pedido-pricing.service';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import { RepScopeService } from '@shared/scope/rep-scope.service';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { type Paginated, buildPaginated } from '@shared/types/pagination';
import { SequenceService } from '@shared/utils/sequence.service';
import type {
  ChangeStatusDto,
  CreatePropostaDto,
  ListPropostasDto,
  PropostaItemInputDto,
  UpdatePropostaDto,
} from './propostas.dto';

const propostaInclude = {
  cliente: { select: { id: true, nome: true, cnpj: true } },
  itens: true,
} satisfies Prisma.PropostaInclude;

type PropostaWithRel = Prisma.PropostaGetPayload<{ include: typeof propostaInclude }>;

const COMISSAO_PADRAO_PCT = 5;

@Injectable()
export class PropostasService {
  private readonly logger = new Logger(PropostasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly pedidoPricing: PedidoPricingService,
    private readonly repScope: RepScopeService,
    private readonly sequence: SequenceService,
  ) {}

  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException('Empresa não definida', ErrorCode.TENANT_ACCESS_DENIED);
    }
    return user.empresaIdAtiva;
  }

  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.PropostaWhereInput> {
    const where: Prisma.PropostaWhereInput = { empresaId: this.requireEmpresa(user) };
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) where.representanteId = { in: scope };
    return where;
  }

  async list(
    user: AuthenticatedUser,
    params: ListPropostasDto,
  ): Promise<Paginated<PropostaWithRel>> {
    const where: Prisma.PropostaWhereInput = { ...(await this.baseWhere(user)) };
    const conds: Prisma.PropostaWhereInput[] = [];
    if (params.search) {
      conds.push({
        OR: [
          { numero: { contains: params.search, mode: 'insensitive' } },
          { cliente: { nome: { contains: params.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (params.status) conds.push({ status: params.status });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.representanteId) conds.push({ representanteId: params.representanteId });
    if (conds.length > 0) where.AND = conds;

    const [total, data] = await Promise.all([
      this.prisma.proposta.count({ where }),
      this.prisma.proposta.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { [params.sortBy]: params.sortOrder },
        include: propostaInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<PropostaWithRel> {
    const proposta = await this.prisma.proposta.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: propostaInclude,
    });
    if (!proposta) throw new NotFoundException('Proposta', id);
    return proposta;
  }

  async create(user: AuthenticatedUser, dto: CreatePropostaDto): Promise<PropostaWithRel> {
    const empresaId = this.requireEmpresa(user);
    const cliente = await this.assertClienteValido(user, dto.clienteId);
    const items = await this.resolveItens(empresaId, cliente.id, dto.itens);
    const totals = this.pedidoPricing.pedidoTotals(
      items.map((i) => ({
        quantidade: i.quantidade,
        precoUnitario: i.precoUnitario,
        desconto: i.desconto,
      })),
      dto.descontoGeral,
      COMISSAO_PADRAO_PCT,
    );

    const representanteId = user.role === 'REP' ? user.id : null;
    const numero = await this.gerarNumero(empresaId);

    const created = await this.prisma.proposta.create({
      data: {
        empresaId,
        numero,
        clienteId: cliente.id,
        representanteId,
        status: 'RASCUNHO',
        probabilidade: dto.probabilidade,
        validoAte: dto.validoAte,
        formaPagamento: dto.formaPagamento,
        condicaoPagamento: dto.condicaoPagamento,
        prazoEntrega: dto.prazoEntrega,
        subtotal: totals.subtotal,
        descontoGeral: dto.descontoGeral,
        valor: totals.total,
        comissaoEstimada: totals.comissao,
        observacoes: dto.observacoes,
        itens: {
          create: items.map((i) => ({
            produtoId: i.produtoId,
            produtoNome: i.nome,
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
            desconto: i.desconto,
            total: i.total,
            negociado: i.negociado,
          })),
        },
      },
      include: propostaInclude,
    });

    this.logger.log(`Proposta ${created.numero} criada — valor R$${totals.total.toFixed(2)}`);
    return created;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdatePropostaDto,
  ): Promise<PropostaWithRel> {
    const existing = await this.findById(user, id);
    if (existing.status === 'ACEITA' || existing.status === 'RECUSADA') {
      throw new BusinessRuleException(`Proposta em status ${existing.status} não pode ser editada`);
    }
    await this.prisma.proposta.updateMany({
      where: { id, empresaId: existing.empresaId },
      data: dto,
    });
    return this.prisma.proposta.findUniqueOrThrow({ where: { id }, include: propostaInclude });
  }

  async changeStatus(
    user: AuthenticatedUser,
    id: string,
    dto: ChangeStatusDto,
  ): Promise<PropostaWithRel> {
    const existing = await this.findById(user, id);
    this.assertTransicaoValida(existing.status, dto.status);
    const data: Prisma.PropostaUpdateManyMutationInput = { status: dto.status };
    if (dto.motivo) {
      data.observacoes = existing.observacoes
        ? `${existing.observacoes}\n[${dto.status}] ${dto.motivo}`
        : `[${dto.status}] ${dto.motivo}`;
    }
    await this.prisma.proposta.updateMany({
      where: { id, empresaId: existing.empresaId },
      data,
    });
    return this.prisma.proposta.findUniqueOrThrow({ where: { id }, include: propostaInclude });
  }

  /**
   * Converte uma proposta ACEITA em pedido. Cria o pedido como RASCUNHO,
   * vincula via Proposta.pedidoId e marca convertidaEm.
   */
  async converterEmPedido(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ pedidoId: string; numero: string }> {
    const empresaId = this.requireEmpresa(user);
    const proposta = await this.findById(user, id);

    if (proposta.status !== 'ACEITA') {
      throw new BusinessRuleException('Apenas propostas aceitas podem ser convertidas em pedido');
    }
    if (proposta.pedidoId) {
      throw new BusinessRuleException(`Proposta já foi convertida no pedido ${proposta.pedidoId}`);
    }

    // AUDITORIA P0-4: número via SequenceService atomic (anti-race)
    const pedidoSeq = await this.sequence.next(empresaId, 'pedido');
    const numero = `PED-${pedidoSeq.toString().padStart(4, '0')}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          empresaId,
          numero,
          clienteId: proposta.clienteId,
          representanteId: proposta.representanteId,
          origem: 'REP_APP',
          status: 'RASCUNHO',
          formaPagamento: proposta.formaPagamento,
          condicaoPagamento: proposta.condicaoPagamento,
          prazoEntrega: proposta.prazoEntrega,
          subtotal: proposta.subtotal,
          descontoGeral: proposta.descontoGeral,
          total: proposta.valor,
          comissao: proposta.comissaoEstimada,
          observacoes: `Originada da proposta ${proposta.numero}${proposta.observacoes ? '\n' + proposta.observacoes : ''}`,
          itens: {
            create: proposta.itens.map((it) => ({
              produtoId: it.produtoId,
              quantidade: it.quantidade,
              precoUnitario: it.precoUnitario,
              desconto: it.desconto,
              total: it.total,
              negociado: it.negociado,
            })),
          },
        },
        select: { id: true, numero: true },
      });
      await tx.proposta.updateMany({
        where: { id: proposta.id, empresaId: proposta.empresaId },
        data: { pedidoId: pedido.id, convertidaEm: new Date() },
      });
      return pedido;
    });
    this.logger.log(`Proposta ${proposta.numero} convertida no pedido ${result.numero}`);
    return { pedidoId: result.id, numero: result.numero };
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  private assertTransicaoValida(from: string, to: string): void {
    const transicoes: Record<string, string[]> = {
      RASCUNHO: ['ENVIADA'],
      ENVIADA: ['NEGOCIACAO', 'AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA', 'EXPIRADA'],
      NEGOCIACAO: ['AGUARDANDO_ASSINATURA', 'ACEITA', 'RECUSADA', 'EXPIRADA'],
      AGUARDANDO_ASSINATURA: ['ACEITA', 'RECUSADA', 'EXPIRADA'],
      ACEITA: [], // final
      RECUSADA: [], // final
      EXPIRADA: ['ENVIADA'], // pode reenviar
    };
    if (!transicoes[from]?.includes(to)) {
      throw new BusinessRuleException(`Transição inválida: ${from} → ${to}`);
    }
  }

  private async assertClienteValido(user: AuthenticatedUser, clienteId: string) {
    const empresaId = this.requireEmpresa(user);
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: {
        id: true,
        empresaId: true,
        representanteId: true,
        omieStatus: true,
      },
    });
    if (!cliente) throw new NotFoundException('Cliente', clienteId);
    const scope = await this.repScope.getRepIds(user);
    if (
      scope !== null &&
      (cliente.representanteId === null || !scope.includes(cliente.representanteId))
    ) {
      throw new ForbiddenException(
        'Cliente não pertence à sua carteira',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return cliente;
  }

  private async resolveItens(
    empresaId: string,
    clienteId: string,
    itens: PropostaItemInputDto[],
  ): Promise<
    Array<{
      produtoId: string;
      nome: string;
      quantidade: number;
      precoUnitario: number;
      desconto: number;
      total: number;
      negociado: boolean;
    }>
  > {
    const produtoIds = itens.map((i) => i.produtoId);
    // AUDITORIA 2026-05-15 P0: filtra por empresaId
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: produtoIds }, empresaId },
      select: { id: true, nome: true, ativo: true, precoTabela: true },
    });
    const map = new Map(produtos.map((p) => [p.id, p]));
    if (produtos.length !== new Set(produtoIds).size) {
      throw new BusinessRuleException('Um ou mais produtos não encontrados nesta empresa');
    }
    const priceMap = await this.pricing.priceForClientBatch(empresaId, clienteId, produtoIds);

    return itens.map((i) => {
      const p = map.get(i.produtoId)!;
      const resolved = priceMap.get(i.produtoId);
      const preco = i.precoUnitarioOverride ?? resolved?.precoFinal ?? p.precoTabela;
      const t = this.pedidoPricing.itemTotal({
        quantidade: i.quantidade,
        precoUnitario: preco,
        desconto: i.desconto,
      });
      return {
        produtoId: i.produtoId,
        nome: p.nome,
        quantidade: i.quantidade,
        precoUnitario: preco,
        desconto: i.desconto,
        total: t.total,
        negociado: !!resolved?.negociado && resolved.vigente,
      };
    });
  }

  /**
   * Gera próximo número PROP-XXXX por empresa de forma ATÔMICA via SequenceService.
   * Auditoria 2026-05-15 P0-4: substitui `count + 1` que tinha race condition.
   * Schema agora também escopa numero por empresa via `@@unique([empresaId, numero])`.
   */
  private async gerarNumero(empresaId: string): Promise<string> {
    const seq = await this.sequence.next(empresaId, 'proposta');
    return `PROP-${seq.toString().padStart(4, '0')}`;
  }
}
