import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { EnvService } from '@config/env.service';
import { PrismaService } from '@database/prisma.service';
import { FinanceiroAutomaticoService } from '@modules/financeiro/financeiro-automatico.service';
import { hojePuro } from '@modules/financeiro/financeiro.regras';
import { IntegracoesService } from '@modules/integracoes/integracoes.service';
import { NotificacoesService } from '@modules/notificacoes/notificacoes.service';
import { FluxoEventBusService } from '@modules/fluxos/fluxo-event-bus.service';
import { dispararPedidoPago } from '@modules/pedidos/pedido-pago.evento';
import { BusinessRuleException, NotFoundException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';
import {
  AsaasClient,
  opcoesCartao,
  type CobrancaAsaas,
  type TaxasAsaas,
} from '@integrations/asaas/asaas.client';
import type { ConfigCheckout } from './checkout.service';

const regra = (msg: string) => new BusinessRuleException(msg, ErrorCode.BUSINESS_RULE_VIOLATION);
const c = (v: number) => Math.round(v * 100);
const r = (centavos: number) => centavos / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Minutos que a reserva das peças ganha quando o cliente começa a pagar. */
export const RESERVA_PAGANDO_MIN = 60;

/** Eventos que significam "pago" (cartão: CONFIRMED já basta; RECEIVED vem ~32 dias depois). */
const PAGO = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const ESTORNO = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
]);
const CANCELA = new Set(['PAYMENT_DELETED', 'PAYMENT_OVERDUE']);

/** Pagamento como o aviso do Asaas descreve (só o que usamos). */
interface PagamentoAviso {
  id?: string;
  installment?: string | null;
  /** Qual parcela (1..N) esta cobrança é, no parcelado. */
  installmentNumber?: number | null;
  netValue?: number;
  billingType?: string;
  /** Data (AAAA-MM-DD) em que o dinheiro cai / caiu na conta Asaas. */
  estimatedCreditDate?: string | null;
  creditDate?: string | null;
}

/** "2026-11-08" → data pura (12:00 UTC); inválida → null. */
const dataAsaas = (v: string | null | undefined): Date | null =>
  v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00.000Z`) : null;

export interface PagamentoPublico {
  metodo: 'PIX' | 'CARTAO';
  parcelas: number;
  valorCobrado: number;
  status: string;
  pix: { payload: string; imagem: string; expiraEm: string } | null;
  invoiceUrl: string | null;
}

/**
 * Checkout da vitrine (entrega 2): o CLIENTE paga o próprio pedido — Pix (QR
 * na vitrine) ou cartão (página segura do Asaas). Regra do Léo (07/10): Pix e
 * cartão à vista = preço da vitrine; parcelado = o cliente paga a taxa.
 *
 * Acesso público, mas só com o CÓDIGO do pedido (HMAC do id), que só quem
 * enviou o pedido recebe. Confirmação do pagamento chega pelo aviso do Asaas
 * (webhook) → pedido PAGO, reserva garantida, baixa no financeiro.
 */
@Injectable()
export class CheckoutPublicoService {
  private readonly logger = new Logger(CheckoutPublicoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integracoes: IntegracoesService,
    private readonly env: EnvService,
    @Optional() private readonly fin?: FinanceiroAutomaticoService,
    @Optional() private readonly notificacoes?: NotificacoesService,
    // Gatilho PEDIDO_PAGO dos fluxos (Léo, 07/10).
    @Optional() private readonly bus?: FluxoEventBusService,
  ) {}

  /** Injetável nos testes. */
  protected cliente(chave: string): AsaasClient {
    return new AsaasClient(chave);
  }

  // ─── Código de acesso do pedido ──────────────────────────────────────────

  /** Código do pedido: HMAC do id com uma chave derivada (rótulo próprio). */
  tokenDoPedido(pedidoId: string): string {
    const base = this.env.get('ENCRYPTION_KEY') || '';
    const chave = createHmac('sha256', base).update('checkout-pedido-v1').digest();
    return createHmac('sha256', chave).update(pedidoId).digest('hex').slice(0, 40);
  }

  private conferirToken(pedidoId: string, token: string | undefined) {
    const esperado = this.tokenDoPedido(pedidoId);
    const t = token ?? '';
    const ok =
      t.length === esperado.length && timingSafeEqual(Buffer.from(t), Buffer.from(esperado));
    // Mesma resposta pra pedido inexistente e código errado: não revela nada.
    if (!ok) throw new NotFoundException('Pedido');
  }

  // ─── Leitura ─────────────────────────────────────────────────────────────

  private async contexto(slug: string, pedidoId: string, token: string | undefined) {
    this.conferirToken(pedidoId, token);
    const p = await this.prisma.pedido.findFirst({
      where: { id: pedidoId, origem: 'VITRINE', empresa: { vitrine: { slug } } },
      select: {
        id: true,
        empresaId: true,
        numero: true,
        status: true,
        total: true,
        contatoNome: true,
        contatoTelefone: true,
        contatoEmail: true,
        clienteId: true,
        cliente: { select: { nome: true, cnpj: true } },
        itens: { select: { precoUnitario: true } },
        entrega: true,
        empresa: { select: { nome: true, config: true } },
      },
    });
    if (!p) throw new NotFoundException('Pedido');
    const cfg = (((p.empresa.config ?? {}) as Record<string, unknown>).checkout ??
      {}) as ConfigCheckout;
    const totalC = c(Number(p.total));
    // Frete a combinar = o total ainda não tem o frete: não cobra online.
    const freteAConfirmar =
      (p.entrega as { freteAConfirmar?: boolean } | null)?.freteAConfirmar === true;
    const semPreco = p.itens.some((i) => Number(i.precoUnitario) <= 0) || freteAConfirmar;
    return { p, cfg, totalC, semPreco, freteAConfirmar };
  }

  /** Opções de pagamento + a cobrança em aberto (se houver). */
  async opcoes(slug: string, pedidoId: string, token: string | undefined) {
    const { p, cfg, totalC, semPreco, freteAConfirmar } = await this.contexto(
      slug,
      pedidoId,
      token,
    );
    const ativo = cfg.ativo === true && !!cfg.taxas;
    const atual = await this.pagamentoAtual(p.empresaId, pedidoId);
    return {
      pedido: { numero: p.numero, status: p.status, total: r(totalC) },
      disponivel: ativo && !semPreco && totalC > 0 && p.status === 'RASCUNHO',
      motivo: !ativo
        ? 'Pagamento online desligado'
        : freteAConfirmar
          ? 'O frete vai ser combinado com você — a equipe fecha o valor pelo WhatsApp'
          : semPreco
            ? 'Há item com preço a confirmar — a equipe fecha o valor com você'
            : p.status !== 'RASCUNHO'
              ? p.status === 'PAGO'
                ? 'Pedido já pago'
                : 'Pedido não está aguardando pagamento'
              : null,
      pix: { valor: r(totalC) },
      cartao: cfg.taxas
        ? opcoesCartao(totalC, cfg.taxas as TaxasAsaas, 12, cfg.jurosMesPct ?? 0).map((o) => ({
            parcelas: o.parcelas,
            total: r(o.totalC),
            parcela: r(o.parcelaC),
          }))
        : [],
      pagamento: atual,
    };
  }

  /** Só o status — a vitrine pergunta enquanto o QR está na tela. */
  async status(slug: string, pedidoId: string, token: string | undefined) {
    const { p } = await this.contexto(slug, pedidoId, token);
    const pg = await this.prisma.pedidoPagamento.findFirst({
      where: { pedidoId },
      orderBy: { criadoEm: 'desc' },
      select: { status: true, metodo: true },
    });
    return {
      pedidoStatus: p.status,
      pago: p.status === 'PAGO' || pg?.status === 'PAGO',
      pagamento: pg,
    };
  }

  private async pagamentoAtual(
    empresaId: string,
    pedidoId: string,
  ): Promise<PagamentoPublico | null> {
    const pg = await this.prisma.pedidoPagamento.findFirst({
      where: { pedidoId, status: { in: ['PENDENTE', 'PAGO'] } },
      orderBy: { criadoEm: 'desc' },
    });
    if (!pg) return null;
    let pix: PagamentoPublico['pix'] = null;
    if (pg.metodo === 'PIX' && pg.status === 'PENDENTE') {
      const asaas = await this.asaasDa(empresaId);
      const q = await asaas.pixQrCode(pg.asaasCobrancaId);
      pix = { payload: q.payload, imagem: q.encodedImage, expiraEm: q.expirationDate };
    }
    return {
      metodo: pg.metodo as 'PIX' | 'CARTAO',
      parcelas: pg.parcelas,
      valorCobrado: Number(pg.valorCobrado),
      status: pg.status,
      pix,
      invoiceUrl: pg.invoiceUrl,
    };
  }

  private async asaasDa(empresaId: string): Promise<AsaasClient> {
    const cred = await this.integracoes
      .obterCredenciaisInternas(empresaId, 'asaas')
      .catch(() => null);
    const chave = (cred?.credenciais as { apiKey?: string } | undefined)?.apiKey;
    if (!chave) throw regra('Pagamento online indisponível agora — fale com a empresa no WhatsApp');
    return this.cliente(chave);
  }

  // ─── Iniciar o pagamento ─────────────────────────────────────────────────

  async iniciar(
    slug: string,
    pedidoId: string,
    dto: {
      token: string;
      metodo: 'PIX' | 'CARTAO';
      parcelas?: number;
      cpfCnpj: string;
      email?: string | null;
    },
  ): Promise<PagamentoPublico> {
    const { p, cfg, totalC, semPreco } = await this.contexto(slug, pedidoId, dto.token);
    if (cfg.ativo !== true || !cfg.taxas) throw regra('Pagamento online desligado nesta loja');
    if (semPreco || totalC <= 0)
      throw regra('Há item com preço a confirmar — a equipe fecha o valor com você');
    if (p.status !== 'RASCUNHO') {
      throw regra(
        p.status === 'PAGO'
          ? 'Este pedido já está pago'
          : 'Este pedido não está aguardando pagamento',
      );
    }
    const parcelas =
      dto.metodo === 'PIX' ? 1 : Math.min(12, Math.max(1, Math.trunc(dto.parcelas ?? 1)));
    const doc = dto.cpfCnpj.replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) throw regra('Informe um CPF ou CNPJ válido');

    const asaas = await this.asaasDa(p.empresaId);

    // Já existe cobrança em aberto: mesma escolha → reaproveita; outra → cancela.
    const aberta = await this.prisma.pedidoPagamento.findFirst({
      where: { pedidoId, status: 'PENDENTE' },
      orderBy: { criadoEm: 'desc' },
    });
    if (aberta && aberta.metodo === dto.metodo && aberta.parcelas === parcelas) {
      return (await this.pagamentoAtual(p.empresaId, pedidoId)) as PagamentoPublico;
    }
    if (aberta) {
      await asaas.cancelarCobranca(aberta.asaasCobrancaId).catch((err: unknown) => {
        this.logger.warn(
          `[checkout] cobrança ${aberta.asaasCobrancaId} não cancelou no Asaas: ${String(err)}`,
        );
      });
      await this.prisma.pedidoPagamento.update({
        where: { id: aberta.id },
        data: { status: 'CANCELADO' },
      });
    }

    // Cliente no Asaas (pelo documento) — o Asaas exige CPF/CNPJ pra cobrar.
    const nome = p.contatoNome?.trim() || p.cliente?.nome || 'Cliente';
    const fone = (p.contatoTelefone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    const cliente =
      (await asaas.acharCliente(doc)) ??
      (await asaas.criarCliente({
        name: nome,
        cpfCnpj: doc,
        ...(fone ? { mobilePhone: fone } : {}),
        ...(dto.email ? { email: dto.email } : {}),
        externalReference: p.clienteId,
      }));
    // O cadastro do cliente só ganha o documento se estava vazio.
    if (!p.cliente?.cnpj) {
      await this.prisma.cliente
        .update({ where: { id: p.clienteId }, data: { cnpj: doc } })
        .catch(() => undefined);
    }

    const opcao = opcoesCartao(totalC, cfg.taxas as TaxasAsaas, 12, cfg.jurosMesPct ?? 0).find(
      (o) => o.parcelas === parcelas,
    );
    const cobradoC = dto.metodo === 'PIX' ? totalC : (opcao?.totalC ?? totalC);
    // Vence amanhã (Brasília): o Pix não "vence" à meia-noite com o cliente pagando.
    const vence = new Date(hojePuro().getTime() + 86_400_000);
    const base = {
      customer: cliente.id,
      dueDate: iso(vence),
      description: `Pedido ${p.numero} — ${p.empresa.nome}`,
      externalReference: pedidoId,
    };
    const cobranca: CobrancaAsaas =
      dto.metodo === 'PIX'
        ? await asaas.criarCobranca({ ...base, billingType: 'PIX', value: r(cobradoC) })
        : parcelas === 1
          ? await asaas.criarCobranca({ ...base, billingType: 'CREDIT_CARD', value: r(cobradoC) })
          : await asaas.criarCobranca({
              ...base,
              billingType: 'CREDIT_CARD',
              installmentCount: parcelas,
              totalValue: r(cobradoC),
            });

    await this.prisma.pedidoPagamento.create({
      data: {
        empresaId: p.empresaId,
        pedidoId,
        metodo: dto.metodo,
        parcelas,
        valorPedido: new Prisma.Decimal(r(totalC).toFixed(2)),
        valorCobrado: new Prisma.Decimal(r(cobradoC).toFixed(2)),
        asaasCobrancaId: cobranca.id,
        asaasParcelamentoId: cobranca.installment ?? null,
        invoiceUrl: cobranca.invoiceUrl ?? null,
      },
    });

    // Quem está pagando não perde a peça pelo relógio da reserva.
    await this.prisma.estoqueReserva.updateMany({
      where: { pedidoId, status: 'ATIVA' },
      data: { expiraEm: new Date(Date.now() + RESERVA_PAGANDO_MIN * 60_000) },
    });
    this.logger.log(
      `[checkout] pedido ${p.numero}: cobrança ${dto.metodo} ${parcelas}x criada (${cobranca.id})`,
    );
    return (await this.pagamentoAtual(p.empresaId, pedidoId)) as PagamentoPublico;
  }

  // ─── Avisos do Asaas → pedido pago ───────────────────────────────────────

  /** Processa os avisos gravados e ainda não processados (chamado no ACK e pelo job). */
  async processarPendentes(limite = 50): Promise<number> {
    const eventos = await this.prisma.asaasEvento.findMany({
      where: { processadoEm: null },
      orderBy: { recebidoEm: 'asc' },
      take: limite,
    });
    for (const ev of eventos) await this.processar(ev.id);
    return eventos.length;
  }

  async processar(eventoId: string): Promise<void> {
    const ev = await this.prisma.asaasEvento.findUnique({ where: { id: eventoId } });
    if (!ev || ev.processadoEm) return;
    try {
      await this.aplicar(ev.empresaId, ev.evento, ev.payload as Record<string, unknown>);
      await this.prisma.asaasEvento.update({
        where: { id: eventoId },
        data: { processadoEm: new Date(), erro: null },
      });
    } catch (err) {
      this.logger.error(`[checkout] aviso ${eventoId} (${ev.evento}) falhou: ${String(err)}`);
      await this.prisma.asaasEvento
        .update({ where: { id: eventoId }, data: { erro: String(err).slice(0, 500) } })
        .catch(() => undefined);
    }
  }

  private async aplicar(empresaId: string, evento: string, payload: Record<string, unknown>) {
    const pay = (payload.payment ?? {}) as PagamentoAviso;
    if (!pay.id) return;
    const pg = await this.prisma.pedidoPagamento.findFirst({
      where: {
        empresaId,
        OR: [
          { asaasCobrancaId: pay.id },
          ...(pay.installment ? [{ asaasParcelamentoId: pay.installment }] : []),
        ],
      },
    });
    if (!pg) return; // cobrança que não é de pedido da vitrine: só registra

    if (PAGO.has(evento)) {
      // 1º aviso de pago (de qualquer parcela): pedido PAGO + títulos por parcela.
      if (pg.status !== 'PAGO') await this.confirmar(pg, pay);
      // Todo aviso: vencimento previsto da parcela e, se RECEBIDO, a baixa dela.
      await this.financeiroDaParcela(pg, pay, evento === 'PAYMENT_RECEIVED');
    } else if (ESTORNO.has(evento)) {
      await this.prisma.pedidoPagamento.update({
        where: { id: pg.id },
        data: { status: 'ESTORNADO' },
      });
      await this.avisar(
        empresaId,
        pg.pedidoId,
        `Estorno/contestação no Asaas (${evento}) — confira o pedido`,
      );
    } else if (CANCELA.has(evento) && pg.status === 'PENDENTE') {
      await this.prisma.pedidoPagamento.update({
        where: { id: pg.id },
        data: { status: 'CANCELADO' },
      });
    }
  }

  /**
   * Pago: cobrança PAGA, reserva garantida, pedido PAGO e o título a receber
   * dividido nas parcelas do cartão (vencendo quando o dinheiro cai) — numa
   * transação. A BAIXA não é aqui: vem com o aviso de RECEBIDO de cada parcela
   * (o cartão só cai ~30 dias depois; dar baixa antes mentia no caixa).
   */
  private async confirmar(
    pg: { id: string; empresaId: string; pedidoId: string; metodo: string; parcelas: number },
    pay: PagamentoAviso,
  ) {
    const netValue = pay.netValue;
    const pix = pg.metodo === 'PIX';
    // Sem a data do Asaas: Pix cai na hora; cartão, em ~30 dias.
    const primeiroCredito =
      dataAsaas(pay.estimatedCreditDate) ??
      dataAsaas(pay.creditDate) ??
      new Date(hojePuro().getTime() + (pix ? 0 : 30 * 86_400_000));
    const rotulo = pix
      ? 'Pix (Asaas)'
      : pg.parcelas > 1
        ? 'cartão (Asaas)'
        : 'cartão à vista (Asaas)';
    const comFinanceiro = this.fin ? await this.fin.preparar(pg.empresaId) : false;
    // Parcelado com juros: o total a receber (lido ANTES da transação; falha = sem juros).
    const totalJuros = comFinanceiro
      ? await this.totalComJuros(pg).catch(() => undefined)
      : undefined;
    const pedido = await this.prisma.$transaction(async (tx) => {
      // CAS: aviso repetido processando junto (ACK + job) — só um passa daqui.
      const cas = await tx.pedidoPagamento.updateMany({
        where: { id: pg.id, status: { not: 'PAGO' } },
        data: {
          status: 'PAGO',
          pagoEm: new Date(),
          ...(typeof netValue === 'number'
            ? { valorLiquido: new Prisma.Decimal(netValue.toFixed(2)) }
            : {}),
        },
      });
      if (cas.count === 0) return null;
      const p = await tx.pedido.findUnique({
        where: { id: pg.pedidoId },
        select: { numero: true, status: true },
      });
      // Cancelado/expirado (ou já pago à mão): não muda sozinho — avisa abaixo.
      if (p?.status !== 'RASCUNHO')
        return { numero: p?.numero, status: p?.status, confirmadoAgora: false };
      await tx.estoqueReserva.updateMany({
        where: { pedidoId: pg.pedidoId, status: 'ATIVA' },
        data: { status: 'CONFIRMADA', expiraEm: null },
      });
      await tx.pedido.updateMany({
        where: { id: pg.pedidoId, status: 'RASCUNHO' },
        data: { status: 'PAGO', pagoEm: new Date() },
      });
      if (comFinanceiro && this.fin) {
        await this.fin.parcelarPedidoNaTx(
          tx,
          pg.pedidoId,
          pg.parcelas,
          primeiroCredito,
          rotulo,
          totalJuros,
        );
      }
      return { numero: p.numero, status: 'PAGO', confirmadoAgora: true };
    });
    if (!pedido) return; // outro processamento já confirmou
    const como = pg.metodo === 'PIX' ? 'Pix' : `cartão ${pg.parcelas}x`;
    if (pedido.confirmadoAgora) {
      await this.avisar(
        pg.empresaId,
        pg.pedidoId,
        `Pedido ${pedido.numero} PAGO online (${como})`,
        'ALTA',
      );
      // Só quem virou o pedido (CAS) dispara — uma vez por pedido.
      await dispararPedidoPago(this.prisma, this.bus, pg.pedidoId, {
        forma: pix ? 'PIX' : 'CARTAO',
        parcelas: pg.parcelas,
        online: true,
      });
    } else if (pedido.status === 'PAGO') {
      // Alguém já tinha dado o pedido como pago à mão: a baixa pode estar em dobro.
      await this.avisar(
        pg.empresaId,
        pg.pedidoId,
        `Pedido ${pedido.numero} já estava PAGO e recebeu pagamento online (${como}) — confira se não foi cobrado duas vezes`,
        'ALTA',
      );
    } else {
      await this.avisar(
        pg.empresaId,
        pg.pedidoId,
        `Pagamento online recebido no pedido ${pedido?.numero ?? ''}, que está ${pedido?.status ?? '?'} — reative ou estorne`,
        'ALTA',
      );
    }
  }

  /**
   * Financeiro de UMA parcela do Asaas: ajusta o vencimento pela data prevista
   * e, no RECEBIDO, dá a baixa na conta Asaas. Pedido cancelado (títulos
   * cancelados) ou parcela já quitada: não faz nada.
   */
  private async financeiroDaParcela(
    pg: { empresaId: string; pedidoId: string; metodo: string; parcelas: number },
    pay: PagamentoAviso,
    recebido: boolean,
  ) {
    if (!this.fin || !(await this.fin.preparar(pg.empresaId))) return;
    const fin = this.fin;
    const parcela = pay.installmentNumber && pay.installmentNumber > 0 ? pay.installmentNumber : 1;
    const pix = pg.metodo === 'PIX';
    await this.prisma.$transaction((tx) =>
      fin.parcelaAsaasNaTx(tx, pg.empresaId, pg.pedidoId, parcela, {
        credito: dataAsaas(pay.creditDate) ?? dataAsaas(pay.estimatedCreditDate),
        recebido,
        forma: pix ? 'PIX' : 'CARTAO',
        observacao: pix
          ? 'Pix recebido pelo Asaas'
          : `Cartão ${pg.parcelas > 1 ? `parcela ${parcela}/${pg.parcelas}` : 'à vista'} recebido pelo Asaas`,
      }),
    );
  }

  /**
   * Parcelado no cartão com juros: o total que a empresa recebe (preço do
   * pedido na hora da cobrança × (1 + juros a.m. × parcelas)). Pix, 1x ou sem
   * juros: undefined (o título fica no valor do pedido).
   */
  private async totalComJuros(pg: {
    id: string;
    empresaId: string;
    metodo: string;
    parcelas: number;
  }): Promise<number | undefined> {
    if (pg.metodo === 'PIX' || pg.parcelas <= 1) return undefined;
    const [e, pagamento] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id: pg.empresaId }, select: { config: true } }),
      this.prisma.pedidoPagamento.findUnique({
        where: { id: pg.id },
        select: { valorPedido: true },
      }),
    ]);
    const juros = (
      (((e?.config ?? {}) as Record<string, unknown>).checkout ?? {}) as ConfigCheckout
    ).jurosMesPct;
    if (!juros || juros <= 0 || !pagamento) return undefined;
    return (
      Math.round(Number(pagamento.valorPedido) * (1 + (juros / 100) * pg.parcelas) * 100) / 100
    );
  }

  private async avisar(
    empresaId: string,
    pedidoId: string,
    titulo: string,
    prioridade: 'ALTA' | 'NORMAL' = 'NORMAL',
  ) {
    await this.notificacoes
      ?.criarParaRole({
        empresaId,
        roles: ['ADMIN', 'DIRECTOR', 'GERENTE'],
        tipo: 'GENERICO',
        titulo,
        mensagem: titulo,
        prioridade,
        link: `/pedidos/${pedidoId}`,
        metadata: { pedidoId, origem: 'CHECKOUT' },
      })
      .catch(() => undefined);
  }
}
