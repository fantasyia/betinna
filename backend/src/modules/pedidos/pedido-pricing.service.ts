import { Injectable } from '@nestjs/common';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/** Teto de desconto por ITEM (%). Acima disto o override é rejeitado (não reprecificado em silêncio). */
const MAX_DESCONTO_ITEM_PCT = 80;

export interface ItemInput {
  quantidade: number;
  precoUnitario: number;
  desconto: number; // %
}

export interface ItemTotal {
  subtotal: number; // qtd * preco
  desconto: number; // valor absoluto descontado
  total: number; // subtotal - desconto
}

export interface PedidoTotals {
  subtotal: number; // soma dos itens sem desconto geral
  totalItens: number; // soma dos itens com desconto por item
  descontoGeral: number; // valor absoluto do desconto geral (MANUAL) aplicado
  descontoAVista: number; // valor absoluto do desconto à vista (automático da empresa)
  descontoAVistaPct: number; // % de desconto à vista aplicado (0 quando não aplicável)
  total: number; // totalItens - descontoGeral - descontoAVista
  comissao: number; // total * % comissão (default 5%)
  maxDescontoPercentual: number; // maior desconto entre itens e geral (NÃO inclui à vista)
}

/** Config de desconto à vista da empresa (campos Empresa.descontoPixPct/descontoBoletoAvistaPct). */
export interface DescontoAVistaConfig {
  descontoPixPct?: number | null;
  descontoBoletoAvistaPct?: number | null;
}

/**
 * Calculadora central do Pedido.
 *
 * Garante que toda a regra de cálculo viva em um lugar só.
 * Usada tanto no preview do front quanto na persistência server-side.
 *
 * Convenções:
 * - Todos os percentuais são números 0-100 (não 0-1)
 * - Resultados arredondados a 2 casas decimais
 * - Sem retornar Infinity ou NaN
 */
@Injectable()
export class PedidoPricingService {
  /**
   * Normaliza um item com possível `precoUnitarioOverride` no `ItemInput` canônico
   * (precoUnitario = preço BASE + desconto EFETIVO).
   *
   * ⚠️ SEGURANÇA (teto de desconto): um override ABAIXO do preço base é desconto DISFARÇADO.
   * Sem convertê-lo em desconto explícito, o teto de aprovação (que só lê `desconto`) enxerga 0%
   * e o REP burla o fluxo de aprovação. Aqui o gap base→override vira desconto efetivo sobre o
   * preço base (implícito do override + explícito informado), mantendo precoUnitario = base — o
   * total fica idêntico ao desejado, mas o teto passa a enxergar o desconto real.
   *
   * PONTO ÚNICO usado por pedidos E propostas — antes cada um tinha sua cópia e a de propostas
   * ficou sem a conversão (CAÇADA-BUG #2: override em proposta burlava o teto via proposta→pedido).
   */
  resolverItemComOverride(input: {
    quantidade: number;
    precoBase: number;
    override?: number | null;
    descontoExplicito?: number | null;
  }): ItemInput {
    const explicito = Math.min(MAX_DESCONTO_ITEM_PCT, Math.max(0, input.descontoExplicito ?? 0));
    const { override, precoBase } = input;
    if (override != null && precoBase > 0 && override < precoBase) {
      const precoFinalDesejado = override * (1 - explicito / 100);
      const efetivo = Math.max(0, (1 - precoFinalDesejado / precoBase) * 100);
      // DECISÃO Leo (2026-07-08): override que implica desconto EFETIVO acima do teto por item é
      // REJEITADO — antes era reprecificado em silêncio pro teto (o item saía mais caro que o valor
      // que o rep digitou, sem aviso, e o cliente da proposta via um preço diferente do negociado).
      if (efetivo > MAX_DESCONTO_ITEM_PCT) {
        throw new BusinessRuleException(
          `Desconto do item (${efetivo.toFixed(1)}%) acima do teto de ${MAX_DESCONTO_ITEM_PCT}%. ` +
            `Ajuste o preço/valor do item.`,
          ErrorCode.DESCONTO_ACIMA_TETO,
        );
      }
      return { quantidade: input.quantidade, precoUnitario: precoBase, desconto: efetivo };
    }
    // Override ausente, ou >= base (sem desconto implícito): usa override ?? base + desconto explícito.
    return {
      quantidade: input.quantidade,
      precoUnitario: override ?? precoBase,
      desconto: explicito,
    };
  }

  /** Calcula o total de um item respeitando qtd, preço unitário e desconto %. */
  itemTotal(item: ItemInput): ItemTotal {
    const qty = Math.max(0, Math.floor(item.quantidade));
    const preco = Math.max(0, item.precoUnitario);
    const desc = Math.min(80, Math.max(0, item.desconto));
    const subtotal = this.round(qty * preco);
    const descontoVal = this.round(subtotal * (desc / 100));
    const total = this.round(subtotal - descontoVal);
    return { subtotal, desconto: descontoVal, total };
  }

  /**
   * Resolve o % de desconto à vista a aplicar com base na forma/condição de
   * pagamento e na config da empresa (B1 — Lote 6).
   *
   * Regras:
   *  - PIX (qualquer condição) → descontoPixPct
   *  - BOLETO + condição 'avista' → descontoBoletoAvistaPct
   *  - Qualquer outra combinação → 0
   *
   * Retorna 0 quando config ausente ou desconto = 0 (feature desligada).
   */
  descontoAVistaPct(
    formaPagamento: string | null | undefined,
    condicaoPagamento: string | null | undefined,
    config: DescontoAVistaConfig | null | undefined,
  ): number {
    if (!config) return 0;
    const forma = (formaPagamento ?? '').toUpperCase();
    const condicao = (condicaoPagamento ?? '').toLowerCase();
    if (forma === 'PIX') {
      return Math.min(50, Math.max(0, config.descontoPixPct ?? 0));
    }
    if (forma === 'BOLETO' && condicao === 'avista') {
      return Math.min(50, Math.max(0, config.descontoBoletoAvistaPct ?? 0));
    }
    return 0;
  }

  /**
   * Calcula os totais consolidados do pedido.
   *
   * @param itens lista de itens (qtd, preço unitário, desconto %)
   * @param descontoGeralPct desconto % MANUAL aplicado sobre o totalItens (0-50)
   * @param comissaoPct % de comissão (default 5)
   * @param descontoAVistaPct % de desconto à vista AUTOMÁTICO (política da empresa, 0-50).
   *        Soma ao desconto geral pra reduzir o total, MAS não conta pro teto de
   *        aprovação (não é desconto que o rep deu — é regra da empresa).
   */
  pedidoTotals(
    itens: ItemInput[],
    descontoGeralPct: number,
    comissaoPct = 5,
    descontoAVistaPct = 0,
  ): PedidoTotals {
    const totaisItens = itens.map((i) => this.itemTotal(i));
    const subtotal = this.round(totaisItens.reduce((s, t) => s + t.subtotal, 0));
    const totalItens = this.round(totaisItens.reduce((s, t) => s + t.total, 0));

    const descGeral = Math.min(50, Math.max(0, descontoGeralPct));
    const descAVista = Math.min(50, Math.max(0, descontoAVistaPct));
    const descontoGeralVal = this.round(totalItens * (descGeral / 100));
    const descontoAVistaVal = this.round(totalItens * (descAVista / 100));
    // Soma os dois descontos, mas capa o total descontado pra nunca passar
    // 90% do totalItens (evita total negativo em combos extremos).
    const descontoTotalVal = this.round(
      Math.min(descontoGeralVal + descontoAVistaVal, totalItens * 0.9),
    );
    const total = this.round(totalItens - descontoTotalVal);

    const comissaoPctSafe = Math.min(50, Math.max(0, comissaoPct));
    const comissao = this.round(total * (comissaoPctSafe / 100));

    const maxItemDescPct = itens.reduce(
      (m, i) => Math.max(m, Math.min(80, Math.max(0, i.desconto))),
      0,
    );
    // CAÇADA-BUG #21 (regra aprovada pelo Leo 2026-07-08): o teto de aprovação avalia o desconto
    // EFETIVO composto do pior item — desconto de item e desconto GERAL COMPÕEM (não são o maior dos
    // dois). Antes usava max(item, geral), então um rep com teto 10% dava 10% no item + 10% geral =
    // 19% efetivo SEM aprovação. Fórmula: 1 − (1 − item)(1 − geral). Desconto à vista continua FORA
    // (é política da empresa, não desconto que o rep deu).
    const maxDescontoPercentual = this.round(
      (1 - (1 - maxItemDescPct / 100) * (1 - descGeral / 100)) * 100,
    );

    return {
      subtotal,
      totalItens,
      descontoGeral: descontoGeralVal,
      descontoAVista: descontoAVistaVal,
      descontoAVistaPct: descAVista,
      total,
      comissao,
      maxDescontoPercentual,
    };
  }

  /** True se algum desconto (item ou geral) excede o teto do rep. */
  excedeTetoDesconto(totals: PedidoTotals, tetoPct: number): boolean {
    return totals.maxDescontoPercentual > tetoPct;
  }

  /**
   * Gate de aprovação de desconto da conversão proposta→pedido (D3/D46) num ÚNICO ponto:
   * descAVista + totais + teto do REP → veredito. Os DOIS caminhos (converterEmPedido
   * autenticado + aceite externo do cliente) chamam ISTO — sem duplicar o cálculo, que já
   * causou bypass quando um caminho recebeu o gate e o outro não. `tetoRep` deve vir 100
   * p/ admin/sem-rep (nunca exige aprovação).
   */
  avaliarAprovacaoProposta(input: {
    itens: ItemInput[];
    descontoGeralPct: number;
    formaPagamento: string | null | undefined;
    condicaoPagamento: string | null | undefined;
    empresaCfg: DescontoAVistaConfig | null | undefined;
    comissaoPct: number;
    tetoRep: number;
  }): {
    requerAprovacao: boolean;
    statusPedido: 'RASCUNHO' | 'AGUARDANDO_APROVACAO';
    maxDescontoPercentual: number;
  } {
    const descAVistaPct = this.descontoAVistaPct(
      input.formaPagamento,
      input.condicaoPagamento,
      input.empresaCfg,
    );
    const totals = this.pedidoTotals(
      input.itens,
      input.descontoGeralPct,
      input.comissaoPct,
      descAVistaPct,
    );
    const requerAprovacao = this.excedeTetoDesconto(totals, input.tetoRep);
    return {
      requerAprovacao,
      statusPedido: requerAprovacao ? 'AGUARDANDO_APROVACAO' : 'RASCUNHO',
      maxDescontoPercentual: totals.maxDescontoPercentual,
    };
  }

  /** Round to 2 decimal places. */
  private round(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }
}
