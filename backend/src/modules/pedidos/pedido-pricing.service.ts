import { Injectable } from '@nestjs/common';

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
    // Teto de aprovação considera SÓ desconto manual (geral + itens).
    // Desconto à vista é política da empresa — não força aprovação.
    const maxDescontoPercentual = Math.max(maxItemDescPct, descGeral);

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

  /** Round to 2 decimal places. */
  private round(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }
}
