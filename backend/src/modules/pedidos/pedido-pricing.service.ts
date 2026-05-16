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
  descontoGeral: number; // valor absoluto do desconto geral aplicado
  total: number; // totalItens - descontoGeral
  comissao: number; // total * % comissão (default 5%)
  maxDescontoPercentual: number; // maior desconto entre itens e geral
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
   * Calcula os totais consolidados do pedido.
   *
   * @param itens lista de itens (qtd, preço unitário, desconto %)
   * @param descontoGeralPct desconto % aplicado sobre o totalItens (0-50)
   * @param comissaoPct % de comissão (default 5)
   */
  pedidoTotals(itens: ItemInput[], descontoGeralPct: number, comissaoPct = 5): PedidoTotals {
    const totaisItens = itens.map((i) => this.itemTotal(i));
    const subtotal = this.round(totaisItens.reduce((s, t) => s + t.subtotal, 0));
    const totalItens = this.round(totaisItens.reduce((s, t) => s + t.total, 0));

    const descGeral = Math.min(50, Math.max(0, descontoGeralPct));
    const descontoGeralVal = this.round(totalItens * (descGeral / 100));
    const total = this.round(totalItens - descontoGeralVal);

    const comissaoPctSafe = Math.min(50, Math.max(0, comissaoPct));
    const comissao = this.round(total * (comissaoPctSafe / 100));

    const maxItemDescPct = itens.reduce(
      (m, i) => Math.max(m, Math.min(80, Math.max(0, i.desconto))),
      0,
    );
    const maxDescontoPercentual = Math.max(maxItemDescPct, descGeral);

    return {
      subtotal,
      totalItens,
      descontoGeral: descontoGeralVal,
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
