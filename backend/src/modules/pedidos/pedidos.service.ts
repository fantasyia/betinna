import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { OmiePedidosService } from '@integrations/omie/omie-pedidos.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { MetricsService } from '@shared/observability/metrics.service';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { PricingService } from '@modules/produtos/pricing.service';
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
import { type ItemInput, PedidoPricingService, type PedidoTotals } from './pedido-pricing.service';
import {
  avaliarPedidoMinimo,
  type PedidoMinimoRegra,
  type PedidoMinimoResultado,
} from './pedido-minimo.util';
import type {
  CancelarPedidoDto,
  CreatePedidoDto,
  DecidirCancelamentoDto,
  ListPedidosDto,
  ListSolicitacoesCancelamentoDto,
  PedidoItemInputDto,
  PreviewPedidoDto,
  SolicitarCancelamentoDto,
  UpdatePedidoDto,
} from './pedidos.dto';

const pedidoInclude = {
  cliente: { select: { id: true, nome: true, cnpj: true, cidade: true, omieStatus: true } },
  representante: { select: { id: true, nome: true, email: true, tetoDesconto: true } },
  aprovador: { select: { id: true, nome: true } },
  itens: {
    include: {
      produto: {
        select: { id: true, nome: true, sku: true, unidade: true, imagem: true },
      },
    },
  },
  aprovacaoDesconto: true,
  // Rastreabilidade: pedido original (quando este foi duplicado).
  pedidoOrigem: { select: { id: true, numero: true } },
} satisfies Prisma.PedidoInclude;

type PedidoWithRel = Prisma.PedidoGetPayload<{ include: typeof pedidoInclude }>;

const COMISSAO_PADRAO_PCT = 5;

@Injectable()
export class PedidosService {
  private readonly logger = new Logger(PedidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly pedidoPricing: PedidoPricingService,
    private readonly omiePedidos: OmiePedidosService,
    private readonly repScope: RepScopeService,
    private readonly bus: FluxoEventBusService,
    private readonly sequence: SequenceService,
    private readonly notificacoes: NotificacoesService,
    private readonly metrics: MetricsService,
  ) {}

  // ─── Acesso ────────────────────────────────────────────────────────────
  private requireEmpresa(user: AuthenticatedUser): string {
    if (!user.empresaIdAtiva) {
      throw new ForbiddenException(
        'Empresa não definida para esta requisição',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return user.empresaIdAtiva;
  }

  private async baseWhere(user: AuthenticatedUser): Promise<Prisma.PedidoWhereInput> {
    const where: Prisma.PedidoWhereInput = { empresaId: this.requireEmpresa(user) };
    const scope = await this.repScope.getRepIds(user);
    if (scope !== null) where.representanteId = { in: scope };
    return where;
  }

  // ─── Preview (calcula sem persistir) ────────────────────────────────────
  async preview(
    user: AuthenticatedUser,
    dto: PreviewPedidoDto,
  ): Promise<{
    totals: PedidoTotals;
    itens: Array<{
      produtoId: string;
      nome: string;
      precoUnitario: number;
      quantidade: number;
      desconto: number;
      total: number;
      negociado: boolean;
      pesoPorUnidade: number | null;
    }>;
    requerAprovacao: boolean;
    tetoRep: number;
    /** Validação do pedido mínimo do tenant (info p/ UI em tempo real). */
    pedidoMinimo: PedidoMinimoResultado;
  }> {
    const empresaId = this.requireEmpresa(user);
    const cliente = await this.assertClienteValido(user, dto.clienteId);
    const items = await this.resolveItens(empresaId, cliente.id, dto.itens);
    // B1 — desconto à vista automático conforme forma/condição + config da empresa
    const descAVistaPct = await this.resolveDescontoAVista(
      empresaId,
      dto.formaPagamento,
      dto.condicaoPagamento,
    );
    const totals = this.pedidoPricing.pedidoTotals(
      items.map((i) => ({
        quantidade: i.quantidade,
        precoUnitario: i.precoUnitario,
        desconto: i.desconto,
      })),
      dto.descontoGeral,
      COMISSAO_PADRAO_PCT,
      descAVistaPct,
    );
    const tetoRep = await this.tetoDoRepAtual(user);
    const requerAprovacao = this.pedidoPricing.excedeTetoDesconto(totals, tetoRep);
    const pedidoMinimo = await this.validarPedidoMinimo(empresaId, items);
    return { totals, itens: items, requerAprovacao, tetoRep, pedidoMinimo };
  }

  // ─── Criar pedido ───────────────────────────────────────────────────────
  async create(user: AuthenticatedUser, dto: CreatePedidoDto): Promise<PedidoWithRel> {
    const empresaId = this.requireEmpresa(user);
    const cliente = await this.assertClienteValido(user, dto.clienteId);
    const items = await this.resolveItens(empresaId, cliente.id, dto.itens);
    // B1 — desconto à vista automático conforme forma/condição + config da empresa
    const descAVistaPct = await this.resolveDescontoAVista(
      empresaId,
      dto.formaPagamento,
      dto.condicaoPagamento,
    );
    const totals = this.pedidoPricing.pedidoTotals(
      items.map((i) => ({
        quantidade: i.quantidade,
        precoUnitario: i.precoUnitario,
        desconto: i.desconto,
      })),
      dto.descontoGeral,
      COMISSAO_PADRAO_PCT,
      descAVistaPct,
    );

    const tetoRep = await this.tetoDoRepAtual(user);
    const requerAprovacao = this.pedidoPricing.excedeTetoDesconto(totals, tetoRep);

    if (requerAprovacao && !dto.motivoDesconto) {
      throw new BusinessRuleException(
        'Desconto acima do teto requer justificativa em motivoDesconto',
        ErrorCode.DESCONTO_ACIMA_TETO,
      );
    }

    // representanteId: se rep está criando, é ele; senão pode ser null (admin/gerente)
    const representanteId = user.role === 'REP' ? user.id : null;

    const numero = await this.gerarNumeroPedido(empresaId);
    const status = requerAprovacao ? 'AGUARDANDO_APROVACAO' : 'RASCUNHO';

    const pedido = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pedido.create({
        data: {
          empresaId,
          numero,
          clienteId: cliente.id,
          representanteId,
          origem: user.role === 'REP' ? 'REP_APP' : 'REP_APP',
          status,
          formaPagamento: dto.formaPagamento,
          condicaoPagamento: dto.condicaoPagamento,
          prazoEntrega: dto.prazoEntrega,
          subtotal: totals.subtotal,
          descontoGeral: dto.descontoGeral,
          total: totals.total,
          comissao: totals.comissao,
          observacoes: dto.observacoes,
          motivoDesconto: dto.motivoDesconto,
          itens: {
            create: items.map((i) => ({
              produtoId: i.produtoId,
              quantidade: i.quantidade,
              precoUnitario: i.precoUnitario,
              desconto: i.desconto,
              total: i.total,
              negociado: i.negociado,
            })),
          },
        },
        include: pedidoInclude,
      });

      // Se requer aprovação, cria a solicitação automaticamente
      if (requerAprovacao && representanteId) {
        await tx.aprovacaoDesconto.create({
          data: {
            pedidoId: created.id,
            representanteId,
            descontoSolicitado: totals.maxDescontoPercentual,
            motivo: dto.motivoDesconto ?? 'sem motivo informado',
            status: 'PENDENTE',
          },
        });
      }

      return created;
    });

    this.logger.log(
      `Pedido ${pedido.numero} criado (${pedido.status}) — total R$${totals.total.toFixed(2)}`,
    );

    this.metrics.pedidosCriados.inc({
      empresa: pedido.empresaId,
      requer_aprovacao: requerAprovacao ? 'true' : 'false',
    });

    // Notifica gerentes+diretores se entrou em aprovação
    if (requerAprovacao && representanteId) {
      void this.notificacoes.criarParaRole({
        empresaId: pedido.empresaId,
        roles: ['GERENTE', 'DIRECTOR'],
        tipo: 'APROVACAO_PENDENTE',
        prioridade: 'ALTA',
        titulo: 'Aprovação de desconto pendente',
        mensagem: `Pedido ${pedido.numero} (${totals.maxDescontoPercentual.toFixed(1)}% desconto) aguarda decisão.`,
        link: `/aprovacoes`,
        metadata: { pedidoId: pedido.id, representanteId },
      });
    }

    return this.findByIdInternal(pedido.id);
  }

  // ─── Listar / detalhar ──────────────────────────────────────────────────
  async list(user: AuthenticatedUser, params: ListPedidosDto): Promise<Paginated<PedidoWithRel>> {
    const where: Prisma.PedidoWhereInput = { ...(await this.baseWhere(user)) };
    const conds: Prisma.PedidoWhereInput[] = [];

    if (params.search) {
      conds.push({
        OR: [
          { numero: { contains: params.search, mode: 'insensitive' } },
          { numeroOmie: { contains: params.search } },
          { cliente: { nome: { contains: params.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (params.status) conds.push({ status: params.status });
    if (params.clienteId) conds.push({ clienteId: params.clienteId });
    if (params.representanteId) conds.push({ representanteId: params.representanteId });
    if (params.dataInicio) conds.push({ criadoEm: { gte: params.dataInicio } });
    if (params.dataFim) conds.push({ criadoEm: { lte: params.dataFim } });

    if (conds.length > 0) where.AND = conds;

    const [total, data] = await Promise.all([
      this.prisma.pedido.count({ where }),
      this.prisma.pedido.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { [params.sortBy]: params.sortOrder },
        include: pedidoInclude,
      }),
    ]);
    return buildPaginated(data, total, params.page, params.limit);
  }

  async findById(user: AuthenticatedUser, id: string): Promise<PedidoWithRel> {
    const pedido = await this.prisma.pedido.findFirst({
      where: { id, ...(await this.baseWhere(user)) },
      include: pedidoInclude,
    });
    if (!pedido) throw new NotFoundException('Pedido', id);
    return pedido;
  }

  private async findByIdInternal(id: string): Promise<PedidoWithRel> {
    const pedido = await this.prisma.pedido.findUnique({ where: { id }, include: pedidoInclude });
    if (!pedido) throw new NotFoundException('Pedido', id);
    return pedido;
  }

  // ─── Atualizar (apenas rascunho ou aguardando aprovação) ────────────────
  async update(user: AuthenticatedUser, id: string, dto: UpdatePedidoDto): Promise<PedidoWithRel> {
    const existing = await this.findById(user, id);
    if (!['RASCUNHO', 'AGUARDANDO_APROVACAO'].includes(existing.status)) {
      throw new BusinessRuleException(`Pedido em status ${existing.status} não pode ser editado`);
    }

    // Separa itens dos demais campos pra controle fino.
    const { itens: novosItens, ...camposGenericos } = dto;

    // Decide se precisa recalcular totais:
    //  - sempre que itens mudarem
    //  - sempre que descontoGeral mudar
    const precisaRecalcular =
      novosItens !== undefined || camposGenericos.descontoGeral !== undefined;

    const itensFinais = novosItens
      ? await this.resolveItens(existing.empresaId, existing.clienteId, novosItens)
      : existing.itens.map((i) => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          // #17 — itens do pedido vêm Decimal; converte pra number (entra no
          // recálculo de totais; o write de volta coage number→Decimal).
          precoUnitario: Number(i.precoUnitario),
          desconto: i.desconto,
          total: Number(i.total),
          negociado: i.negociado,
        }));

    const descontoGeralFinal = camposGenericos.descontoGeral ?? existing.descontoGeral;

    let totalsRecalc: PedidoTotals | null = null;
    let requerAprovacao = false;
    if (precisaRecalcular) {
      totalsRecalc = this.pedidoPricing.pedidoTotals(
        itensFinais.map((i) => ({
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
          desconto: i.desconto,
        })),
        descontoGeralFinal,
        COMISSAO_PADRAO_PCT,
      );

      // Se mudou pra desconto acima do teto sem motivo, bloqueia.
      const tetoRep = await this.tetoDoRepAtual(user);
      requerAprovacao = this.pedidoPricing.excedeTetoDesconto(totalsRecalc, tetoRep);
      if (requerAprovacao && !(camposGenericos.motivoDesconto ?? existing.motivoDesconto)) {
        throw new BusinessRuleException(
          'Desconto acima do teto requer justificativa em motivoDesconto',
          ErrorCode.DESCONTO_ACIMA_TETO,
        );
      }
    }

    // FIX controle de desconto: edição que leva o desconto acima do teto DEVE
    // entrar em aprovação. Antes o update só exigia o motivo mas deixava o status
    // como estava (RASCUNHO) e NÃO criava a AprovacaoDesconto → o pedido ia direto
    // pro OMIE sem o gerente ver (bypass). Agora replica a transição do create().
    const entrandoEmAprovacao = requerAprovacao && existing.status !== 'AGUARDANDO_APROVACAO';
    const motivoAprovacao =
      camposGenericos.motivoDesconto ?? existing.motivoDesconto ?? 'sem motivo informado';

    await this.prisma.$transaction(async (tx) => {
      // Atualiza campos escalares (e totais quando recalculou)
      await tx.pedido.update({
        where: { id },
        data: {
          ...camposGenericos,
          ...(totalsRecalc && {
            subtotal: totalsRecalc.subtotal,
            total: totalsRecalc.total,
            comissao: totalsRecalc.comissao,
          }),
          // Só força AGUARDANDO_APROVACAO quando exceder o teto. Quando NÃO
          // exceder, não mexe no status (não inventa política de "voltar a
          // RASCUNHO" — decisão de produto pendente).
          ...(requerAprovacao ? { status: 'AGUARDANDO_APROVACAO' as const } : {}),
        },
      });

      // Se itens foram fornecidos, replace total
      if (novosItens) {
        await tx.pedidoItem.deleteMany({ where: { pedidoId: id } });
        await tx.pedidoItem.createMany({
          data: itensFinais.map((i) => ({
            pedidoId: id,
            produtoId: i.produtoId,
            quantidade: i.quantidade,
            precoUnitario: i.precoUnitario,
            desconto: i.desconto,
            total: i.total,
            negociado: i.negociado,
          })),
        });
      }

      // Cria/atualiza a solicitação de aprovação (upsert — pedidoId é @unique).
      // Só quando há rep responsável (mesma regra do create). Editar reabre como
      // PENDENTE pra o gerente não decidir sobre um valor já alterado.
      if (requerAprovacao && totalsRecalc && existing.representanteId) {
        await tx.aprovacaoDesconto.upsert({
          where: { pedidoId: id },
          create: {
            pedidoId: id,
            representanteId: existing.representanteId,
            descontoSolicitado: totalsRecalc.maxDescontoPercentual,
            motivo: motivoAprovacao,
            status: 'PENDENTE',
          },
          update: {
            descontoSolicitado: totalsRecalc.maxDescontoPercentual,
            motivo: motivoAprovacao,
            status: 'PENDENTE',
            gerenteId: null,
            comentarioAprovador: null,
            resolvidoEm: null,
          },
        });
      }
    });

    // Notifica gerência só ao ENTRAR em aprovação (não a cada edição seguinte).
    if (entrandoEmAprovacao && existing.representanteId && totalsRecalc) {
      void this.notificacoes.criarParaRole({
        empresaId: existing.empresaId,
        roles: ['GERENTE', 'DIRECTOR'],
        tipo: 'APROVACAO_PENDENTE',
        prioridade: 'ALTA',
        titulo: 'Aprovação de desconto pendente',
        mensagem: `Pedido ${existing.numero} (${totalsRecalc.maxDescontoPercentual.toFixed(1)}% desconto) aguarda decisão.`,
        link: `/aprovacoes`,
        metadata: { pedidoId: id, representanteId: existing.representanteId },
      });
    }

    return this.findByIdInternal(id);
  }

  // ─── Duplicar pedido ─────────────────────────────────────────────────
  /**
   * Cria um NOVO pedido como cópia do existente.
   *
   * - Itens, formaPagamento, condicao, descontoGeral, observacoes copiados
   * - Preços recalculados pelo PricingService (preço pode ter mudado)
   * - `pedidoOrigemId` aponta pro original (rastreabilidade)
   * - Status inicial: RASCUNHO (ou AGUARDANDO_APROVACAO se desconto exceder teto)
   * - Cliente: mesmo do original (passa pelo assertClienteValido — se cliente
   *   estiver bloqueado/inativo, bloqueia o duplicado)
   *
   * Permissão idêntica a `create` — quem pode criar pode duplicar.
   */
  async duplicar(user: AuthenticatedUser, id: string): Promise<PedidoWithRel> {
    const original = await this.findById(user, id);

    const itens: PedidoItemInputDto[] = original.itens.map((i) => ({
      produtoId: i.produtoId,
      quantidade: i.quantidade,
      desconto: i.desconto,
      // Não copia precoUnitarioOverride — preço atual é o que vale
    }));

    if (itens.length === 0) {
      throw new BusinessRuleException('Pedido original sem itens — nada a duplicar');
    }

    const novo = await this.create(user, {
      clienteId: original.clienteId,
      itens,
      formaPagamento: original.formaPagamento,
      condicaoPagamento:
        (original.condicaoPagamento as CreatePedidoDto['condicaoPagamento']) ?? '30dias',
      prazoEntrega: original.prazoEntrega ?? undefined,
      descontoGeral: original.descontoGeral,
      observacoes: original.observacoes
        ? `Duplicado de #${original.numero}. ${original.observacoes}`
        : `Duplicado de #${original.numero}`,
      motivoDesconto: original.motivoDesconto ?? undefined,
    });

    // Marca a origem pra rastreabilidade
    await this.prisma.pedido.update({
      where: { id: novo.id },
      data: { pedidoOrigemId: original.id },
    });

    this.logger.log(`Pedido ${novo.numero} duplicado de ${original.numero} (id=${original.id})`);

    return this.findByIdInternal(novo.id);
  }

  // ─── Avançar status (ENVIADO → ENTREGUE, etc.) ─────────────────────────
  /**
   * Avança o pedido para o próximo status linear do ciclo de vida:
   * ENVIADO_OMIE → PAGO → EM_SEPARACAO → ENVIADO → ENTREGUE.
   * Apenas ADMIN/DIRECTOR podem marcar como ENTREGUE; outros status exigem role >= GERENTE.
   */
  async avancarStatus(user: AuthenticatedUser, id: string): Promise<PedidoWithRel> {
    const pedido = await this.findById(user, id);
    const PROXIMOS: Partial<Record<string, string>> = {
      ENVIADO_OMIE: 'PAGO',
      PAGO: 'EM_SEPARACAO',
      EM_SEPARACAO: 'ENVIADO',
      ENVIADO: 'ENTREGUE',
    };
    const proximo = PROXIMOS[pedido.status];
    if (!proximo) {
      throw new BusinessRuleException(
        `Status ${pedido.status} não pode avançar`,
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    if (proximo === 'ENTREGUE' && !['ADMIN', 'DIRECTOR', 'GERENTE'].includes(user.role)) {
      throw new BusinessRuleException(
        'Apenas ADMIN, DIRECTOR ou GERENTE podem marcar pedido como entregue',
        ErrorCode.FORBIDDEN,
      );
    }

    // CAS: inclui o status atual no where — duas requisições concorrentes sobre o mesmo
    // pedido não avançam ambas (reescrevendo entregueEm e disparando PEDIDO_ENTREGUE 2×).
    const cas = await this.prisma.pedido.updateMany({
      where: { id, empresaId: pedido.empresaId, status: pedido.status as never },
      // Marca entregueEm ao virar ENTREGUE (base da janela de devolução).
      data: {
        status: proximo as never,
        ...(proximo === 'ENTREGUE' ? { entregueEm: new Date() } : {}),
      },
    });
    if (cas.count === 0) {
      throw new BusinessRuleException(
        'Pedido mudou de status — recarregue e tente novamente',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }
    const updated = await this.prisma.pedido.findUniqueOrThrow({
      where: { id },
      include: pedidoInclude,
    });
    this.logger.log(`Pedido ${pedido.numero}: ${pedido.status} → ${proximo}`);

    // Trigger: PEDIDO_ENTREGUE — só a transição vencedora (count===1) dispara.
    if (proximo === 'ENTREGUE') {
      void this.bus.disparar(pedido.empresaId, 'PEDIDO_ENTREGUE', {
        pedidoId: pedido.id,
        // #17 — total agora é Decimal; converte pra number no payload do fluxo
        // (preserva o JSON como número, não string, pra interpolação/consumo).
        pedido: { id: pedido.id, numero: pedido.numero, total: Number(pedido.total) },
        clienteId: pedido.clienteId,
        cliente: { id: pedido.cliente.id, nome: pedido.cliente.nome },
        representanteId: pedido.representanteId,
      });
    }

    return updated;
  }

  // ─── Cancelar ───────────────────────────────────────────────────────────
  async cancelar(
    user: AuthenticatedUser,
    id: string,
    dto: CancelarPedidoDto,
  ): Promise<PedidoWithRel> {
    const existing = await this.findById(user, id);
    if (['ENTREGUE', 'CANCELADO'].includes(existing.status)) {
      throw new BusinessRuleException(`Pedido em status ${existing.status} não pode ser cancelado`);
    }
    // CAS: só cancela se ainda não estiver ENTREGUE/CANCELADO (corrida com avançar/cancelar).
    const cas = await this.prisma.pedido.updateMany({
      where: {
        id,
        empresaId: existing.empresaId,
        status: { notIn: ['ENTREGUE', 'CANCELADO'] as never },
      },
      data: {
        status: 'CANCELADO',
        observacoes: dto.motivo
          ? `${existing.observacoes ? existing.observacoes + '\n' : ''}[Cancelado] ${dto.motivo}`
          : existing.observacoes,
      },
    });
    if (cas.count === 0) {
      throw new BusinessRuleException(
        'Pedido mudou de status — recarregue e tente novamente',
        ErrorCode.BUSINESS_RULE_VIOLATION,
      );
    }

    // Fidelidade removida do projeto Betinna (gerenciada agora no ERP do
    // cliente). Não há mais estorno de pontos em cancelamento — limpo 2026-05-21.

    return this.prisma.pedido.findUniqueOrThrow({ where: { id }, include: pedidoInclude });
  }

  // ─── P6.2 — Solicitação de cancelamento (rep/gerente → diretor) ─────────

  /**
   * REP/GERENTE pede pra cancelar um pedido com justificativa. Cria solicitação
   * PENDENTE — diretor/admin decide. NÃO cancela o pedido ainda.
   */
  async solicitarCancelamento(
    user: AuthenticatedUser,
    pedidoId: string,
    dto: SolicitarCancelamentoDto,
  ) {
    const pedido = await this.findById(user, pedidoId); // valida tenant + scope rep
    if (['ENTREGUE', 'CANCELADO'].includes(pedido.status)) {
      throw new BusinessRuleException(`Pedido em status ${pedido.status} não pode ser cancelado`);
    }
    // Não permite múltiplas solicitações PENDENTES pro mesmo pedido
    const existePendente = await this.prisma.pedidoCancelamentoSolicitacao.findFirst({
      where: { pedidoId, status: 'PENDENTE' },
      select: { id: true },
    });
    if (existePendente) {
      throw new BusinessRuleException(
        'Já existe uma solicitação de cancelamento pendente pra este pedido',
      );
    }
    const solicitacao = await this.prisma.pedidoCancelamentoSolicitacao.create({
      data: {
        pedidoId,
        solicitanteId: user.id,
        motivo: dto.motivo,
      },
      include: {
        solicitante: { select: { id: true, nome: true } },
        pedido: { select: { id: true, numero: true, total: true } },
      },
    });
    this.logger.log(
      `Solicitação de cancelamento #${solicitacao.id} criada pra pedido ${pedido.numero} ` +
        `por ${user.nome} (${user.role})`,
    );
    return solicitacao;
  }

  /**
   * Lista solicitações de cancelamento — visível pra DIRECTOR/ADMIN do tenant.
   * REP/GERENTE só vê as próprias (filtra por solicitanteId).
   */
  async listSolicitacoesCancelamento(
    user: AuthenticatedUser,
    dto: ListSolicitacoesCancelamentoDto,
  ): Promise<Paginated<unknown>> {
    const empresaId = this.requireEmpresa(user);
    const where: Prisma.PedidoCancelamentoSolicitacaoWhereInput = {
      pedido: { empresaId },
      ...(dto.status ? { status: dto.status } : {}),
    };
    // REP/GERENTE só vê suas próprias solicitações
    if (user.role === 'REP' || user.role === 'GERENTE') {
      where.solicitanteId = user.id;
    }
    const [data, total] = await Promise.all([
      this.prisma.pedidoCancelamentoSolicitacao.findMany({
        where,
        include: {
          solicitante: { select: { id: true, nome: true } },
          decididoPor: { select: { id: true, nome: true } },
          pedido: {
            select: {
              id: true,
              numero: true,
              total: true,
              status: true,
              cliente: { select: { id: true, nome: true } },
              representante: { select: { id: true, nome: true } },
            },
          },
        },
        orderBy: { criadoEm: 'desc' },
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.prisma.pedidoCancelamentoSolicitacao.count({ where }),
    ]);
    return buildPaginated(data, total, dto.page, dto.limit);
  }

  /**
   * DIRECTOR/ADMIN decide a solicitação. APROVADA dispara o cancelamento real
   * do pedido (chamando cancelar() internamente). REJEITADA só grava decisão.
   */
  async decidirCancelamento(
    user: AuthenticatedUser,
    solicitacaoId: string,
    dto: DecidirCancelamentoDto,
  ) {
    const empresaId = this.requireEmpresa(user);
    const solicitacao = await this.prisma.pedidoCancelamentoSolicitacao.findFirst({
      where: { id: solicitacaoId, pedido: { empresaId } },
      include: {
        pedido: { select: { id: true, status: true, observacoes: true, empresaId: true } },
      },
    });
    if (!solicitacao) {
      throw new NotFoundException('Solicitação de cancelamento');
    }
    if (solicitacao.status !== 'PENDENTE') {
      throw new BusinessRuleException(
        `Solicitação já está em status ${solicitacao.status} — não pode ser decidida novamente`,
      );
    }
    // Atômico: cancelar o pedido + gravar a decisão num único $transaction — senão o 2º
    // write podia falhar e deixar o pedido CANCELADO com a solicitação ainda PENDENTE
    // (re-decisão possível + perda da autoria/timestamp da aprovação).
    const updated = await this.prisma.$transaction(async (tx) => {
      // CAS: claim da decisão (PENDENTE → dto.decisao). Duas decisões concorrentes
      // (duplo-clique, GERENTE+DIRECTOR) → só a 1ª casa count===1; a 2ª aborta a tx
      // inteira (inclusive o cancelamento do pedido), sem sobrescrever autoria/timestamp.
      const cas = await tx.pedidoCancelamentoSolicitacao.updateMany({
        where: { id: solicitacaoId, status: 'PENDENTE' },
        data: {
          status: dto.decisao,
          decididoPorId: user.id,
          decididoEm: new Date(),
          decisaoComentario: dto.comentario,
        },
      });
      if (cas.count === 0) {
        throw new BusinessRuleException(
          'Solicitação já foi decidida — recarregue',
          ErrorCode.BUSINESS_RULE_VIOLATION,
        );
      }
      if (dto.decisao === 'APROVADA') {
        const motivoFinal =
          solicitacao.motivo +
          (dto.comentario ? `\n[Aprovado por ${user.nome}] ${dto.comentario}` : '');
        await tx.pedido.updateMany({
          where: { id: solicitacao.pedidoId, empresaId },
          data: {
            status: 'CANCELADO',
            observacoes: `${solicitacao.pedido.observacoes ? solicitacao.pedido.observacoes + '\n' : ''}[Cancelado via solicitação #${solicitacao.id}] ${motivoFinal}`,
          },
        });
      }
      return tx.pedidoCancelamentoSolicitacao.findUniqueOrThrow({
        where: { id: solicitacaoId },
        include: {
          solicitante: { select: { id: true, nome: true } },
          decididoPor: { select: { id: true, nome: true } },
          pedido: { select: { id: true, numero: true, status: true } },
        },
      });
    });
    this.logger.log(`Solicitação #${solicitacaoId} ${dto.decisao} por ${user.nome} (${user.role})`);
    return updated;
  }

  // ─── B2 — Ações em massa (best-effort) ──────────────────────────────────

  /**
   * Envia vários pedidos pro OMIE. Best-effort: processa um por um, captura
   * falhas individuais e retorna o resumo. Síncrono (sem BullMQ) — OMIE em
   * demo e volume baixo no MVP; migra pra fila quando crescer.
   */
  async bulkEnviarOmie(
    user: AuthenticatedUser,
    ids: string[],
  ): Promise<{ ok: number; falhas: Array<{ id: string; erro: string }> }> {
    const falhas: Array<{ id: string; erro: string }> = [];
    let ok = 0;
    for (const id of ids) {
      try {
        await this.enviarParaOmie(user, id);
        ok += 1;
      } catch (err) {
        falhas.push({ id, erro: err instanceof Error ? err.message : String(err) });
      }
    }
    this.logger.log(`Bulk OMIE: ${ok} ok, ${falhas.length} falhas (user ${user.nome})`);
    return { ok, falhas };
  }

  /**
   * Cancela vários pedidos. DIRECTOR/ADMIN (gate no controller — P6).
   * Best-effort: pedidos já entregues/cancelados caem em falhas, resto cancela.
   */
  async bulkCancelar(
    user: AuthenticatedUser,
    ids: string[],
    motivo?: string,
  ): Promise<{ ok: number; falhas: Array<{ id: string; erro: string }> }> {
    const falhas: Array<{ id: string; erro: string }> = [];
    let ok = 0;
    for (const id of ids) {
      try {
        await this.cancelar(user, id, { motivo });
        ok += 1;
      } catch (err) {
        falhas.push({ id, erro: err instanceof Error ? err.message : String(err) });
      }
    }
    this.logger.log(`Bulk cancelar: ${ok} ok, ${falhas.length} falhas (user ${user.nome})`);
    return { ok, falhas };
  }

  // ─── Enviar pra OMIE ────────────────────────────────────────────────────
  async enviarParaOmie(user: AuthenticatedUser, id: string): Promise<PedidoWithRel> {
    const pedido = await this.findById(user, id);

    if (pedido.status === 'ENVIADO_OMIE' || pedido.status === 'PAGO') {
      throw new BusinessRuleException(`Pedido já está em status ${pedido.status}`);
    }
    if (pedido.status === 'CANCELADO') {
      throw new BusinessRuleException('Pedido cancelado não pode ser enviado ao OMIE');
    }
    if (pedido.status === 'AGUARDANDO_APROVACAO') {
      const apr = pedido.aprovacaoDesconto;
      if (!apr || apr.status !== 'APROVADA') {
        throw new BusinessRuleException(
          'Pedido aguardando aprovação de desconto não pode ir ao OMIE',
          ErrorCode.APROVACAO_PENDENTE,
        );
      }
    }

    // Verifica novamente o status OMIE do cliente (pode ter sido bloqueado).
    // Hardening: filtro por empresaId — defesa em profundidade mesmo que
    // clienteId já tenha vindo de pedido validado pelo tenant.
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: pedido.clienteId, empresaId: pedido.empresaId },
      select: { omieStatus: true },
    });
    if (!cliente || cliente.omieStatus !== 'ATIVO') {
      throw new BusinessRuleException(
        'Cliente bloqueado no OMIE — não é possível enviar pedido',
        ErrorCode.CLIENTE_BLOQUEADO_OMIE,
      );
    }

    // Pedido mínimo configurável (Empresa.config.pedidoMinimo): rascunho pode
    // ficar abaixo, mas não vai ao OMIE sem atingir o mínimo do tenant.
    const itensPedido = pedido.itens ?? [];
    const produtoIds = itensPedido.map((i) => i.produtoId);
    const pesos = produtoIds.length
      ? await this.prisma.produto.findMany({
          where: { id: { in: produtoIds }, empresaId: pedido.empresaId },
          select: { id: true, pesoPorUnidade: true },
        })
      : [];
    const pesoMap = new Map(
      (pesos ?? []).map((p) => [p.id, p.pesoPorUnidade != null ? Number(p.pesoPorUnidade) : null]),
    );
    const minimo = await this.validarPedidoMinimo(
      pedido.empresaId,
      itensPedido.map((i) => ({
        quantidade: i.quantidade,
        total: Number(i.total),
        pesoPorUnidade: pesoMap.get(i.produtoId) ?? null,
      })),
    );
    if (!minimo.ok) {
      throw new BusinessRuleException(minimo.mensagem ?? 'Pedido abaixo do mínimo configurado');
    }

    // Push real pro OMIE (demo mode retorna número fake mas o fluxo é idêntico).
    // OmiePedidosService já atualiza Pedido (status, numeroOmie, enviadoOmieEm)
    // e registra sync OK na IntegracaoConexao.
    // P3 defensive: passa empresaId pro OMIE service filtrar findFirst também.
    // user.empresaIdAtiva pode ser null em system-cron contexts; convertemos pra undefined.
    await this.omiePedidos.enviarPedido(id, user.empresaIdAtiva ?? undefined);

    // Fidelidade removida do projeto Betinna (gerenciada no ERP do cliente).
    // Não há mais crédito automático aqui — limpo 2026-05-21.

    return this.findByIdInternal(id);
  }

  // ─── Helpers internos ──────────────────────────────────────────────────
  private async assertClienteValido(user: AuthenticatedUser, clienteId: string) {
    const empresaId = this.requireEmpresa(user);
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      select: {
        id: true,
        empresaId: true,
        nome: true,
        omieStatus: true,
        representanteId: true,
      },
    });
    if (!cliente) {
      throw new NotFoundException('Cliente', clienteId);
    }
    if (cliente.omieStatus !== 'ATIVO') {
      throw new BusinessRuleException(
        'Cliente bloqueado no OMIE — não é possível abrir pedido. Acione o financeiro.',
        ErrorCode.CLIENTE_BLOQUEADO_OMIE,
      );
    }
    const scope = await this.repScope.getRepIds(user);
    if (
      scope !== null &&
      (cliente.representanteId === null || !scope.includes(cliente.representanteId))
    ) {
      throw new ForbiddenException(
        'Este cliente não está na sua carteira',
        ErrorCode.TENANT_ACCESS_DENIED,
      );
    }
    return cliente;
  }

  /**
   * Resolve o preço unitário de cada item via PricingService,
   * preserva override quando informado e marca `negociado`.
   */
  private async resolveItens(
    empresaId: string,
    clienteId: string,
    itens: PedidoItemInputDto[],
  ): Promise<
    Array<{
      produtoId: string;
      nome: string;
      quantidade: number;
      precoUnitario: number;
      desconto: number;
      total: number;
      negociado: boolean;
      /** Peso unitário em kg (null = produto sem peso cadastrado). */
      pesoPorUnidade: number | null;
    }>
  > {
    const produtoIds = itens.map((i) => i.produtoId);
    // AUDITORIA 2026-05-15 P0: filtra por empresaId — impede REP de injetar
    // produtoId de outra empresa no pedido.
    const produtos = await this.prisma.produto.findMany({
      where: { id: { in: produtoIds }, empresaId },
      select: { id: true, nome: true, ativo: true, precoTabela: true, pesoPorUnidade: true },
    });
    const produtosMap = new Map(produtos.map((p) => [p.id, p]));
    if (produtos.length !== new Set(produtoIds).size) {
      throw new BusinessRuleException('Um ou mais produtos não foram encontrados nesta empresa');
    }
    for (const p of produtos) {
      if (!p.ativo) {
        throw new BusinessRuleException(`Produto "${p.nome}" está inativo`);
      }
    }

    const priceMap = await this.pricing.priceForClientBatch(empresaId, clienteId, produtoIds);

    const calc: ItemInput[] = itens.map((i) => {
      const resolved = priceMap.get(i.produtoId);
      const preco =
        i.precoUnitarioOverride ??
        resolved?.precoFinal ??
        Number(produtosMap.get(i.produtoId)!.precoTabela);
      return { quantidade: i.quantidade, precoUnitario: preco, desconto: i.desconto };
    });

    return itens.map((i, idx) => {
      const resolved = priceMap.get(i.produtoId);
      const preco = calc[idx].precoUnitario;
      const t = this.pedidoPricing.itemTotal(calc[idx]);
      const peso = produtosMap.get(i.produtoId)!.pesoPorUnidade;
      return {
        produtoId: i.produtoId,
        nome: produtosMap.get(i.produtoId)!.nome,
        quantidade: i.quantidade,
        precoUnitario: preco,
        desconto: i.desconto,
        total: t.total,
        negociado: !!resolved?.negociado && resolved.vigente,
        pesoPorUnidade: peso != null ? Number(peso) : null,
      };
    });
  }

  /**
   * Avalia o pedido mínimo configurado pelo tenant (Empresa.config.pedidoMinimo).
   * Usado no preview (info p/ UI) e no envio ao OMIE (gate). Sem config → ok.
   * Peso = Σ quantidade × pesoPorUnidade (produto sem peso cadastrado conta 0).
   */
  private async validarPedidoMinimo(
    empresaId: string,
    items: Array<{ quantidade: number; total: number; pesoPorUnidade: number | null }>,
  ): Promise<PedidoMinimoResultado> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { config: true },
    });
    const regra = (empresa?.config as { pedidoMinimo?: PedidoMinimoRegra } | null)?.pedidoMinimo;
    const totais = {
      valor: items.reduce((s, i) => s + i.total, 0),
      peso: items.reduce((s, i) => s + i.quantidade * (i.pesoPorUnidade ?? 0), 0),
      quantidade: items.reduce((s, i) => s + i.quantidade, 0),
    };
    return avaliarPedidoMinimo(regra, totais);
  }

  /** Teto de desconto autônomo do rep atual (default 0% pra admin/gerente). */
  private async tetoDoRepAtual(user: AuthenticatedUser): Promise<number> {
    if (user.role !== 'REP') return 100; // admin/gerente: nunca dispara aprovação
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: user.id },
      select: { tetoDesconto: true },
    });
    return usuario?.tetoDesconto ?? 0;
  }

  /**
   * B1 — Resolve o % de desconto à vista da empresa pra forma/condição dadas.
   * Lê config da Empresa e delega a regra pro PedidoPricingService.
   * Retorna 0 quando config zerada (feature desligada).
   */
  private async resolveDescontoAVista(
    empresaId: string,
    formaPagamento: string | null | undefined,
    condicaoPagamento: string | null | undefined,
  ): Promise<number> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { descontoPixPct: true, descontoBoletoAvistaPct: true },
    });
    return this.pedidoPricing.descontoAVistaPct(formaPagamento, condicaoPagamento, empresa);
  }

  /**
   * Gera próximo número PED-XXXX por empresa de forma ATÔMICA via SequenceService.
   * Auditoria 2026-05-15, P0-4: substitui o `count + 1` que causava race
   * condition (dois creates concorrentes geravam o mesmo número).
   */
  private async gerarNumeroPedido(empresaId: string): Promise<string> {
    const seq = await this.sequence.next(empresaId, 'pedido');
    return `PED-${seq.toString().padStart(4, '0')}`;
  }
}
