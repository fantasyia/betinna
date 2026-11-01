import type { ItemPedido } from '@modules/pedidos-marketplace/financeiro';
import type { Situacao } from '@modules/pedidos-marketplace/situacao';

/**
 * Pedido da Shein (Open API, /order/order-detail) → pedido de marketplace do
 * app (01/11). PURO. Status pela documentação oficial (conferida em 01/11):
 * 1 a processar · 2 a enviar · 3 a enviar pela Shein · 4 enviado · 5 entregue ·
 * 6 reembolsado · 7 aguardando coleta · 8 avaria/extravio · 9 recusado.
 * Cada peça é um goodsId (1 unidade).
 */

export interface SheinItem {
  goodsId?: number | string;
  sellerSku?: string | null;
  goodsTitle?: string | null;
  newGoodsStatus?: number | null;
  goodsExchangeTag?: number | null;
  sellerCurrencyPrice?: number | null;
  commission?: number | null;
  performanceServiceCharge?: number | null;
  skuAttribute?: Array<{ attrName?: string; language?: string }> | null;
}

export interface SheinPedido {
  orderNo: string;
  orderStatus?: number | string | null;
  orderGoodsInfoList?: SheinItem[] | null;
  packageWaybillList?: Array<{ waybillNo?: string | null }> | null;
  productTotalPrice?: number | null;
  storeDiscountTotalPrice?: number | null;
  promotionDiscountTotalPrice?: number | null;
  totalCommission?: number | null;
  totalPerformanceServiceCharge?: number | null;
  sellerShippingFee?: number | null;
  estimatedGrossIncome?: number | null;
  orderTime?: string | null;
  pickUpTime?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Status desconhecido ESTOURA: num pedido, um default silencioso vira uma
 * situação plausível que ninguém pediu (lição do operador "equals", 10/09).
 */
export function situacaoShein(status: number, saiuParaEntrega: boolean): Situacao {
  switch (status) {
    case 1:
    case 2:
    case 3:
    case 7:
      return 'A_ENVIAR';
    case 4:
      return 'ENVIADO';
    case 5:
      return 'ENTREGUE';
    case 6:
      // Reembolso antes de sair = cancelado; depois de sair = devolução.
      return saiuParaEntrega ? 'EM_DEVOLUCAO' : 'CANCELADO';
    case 8:
    case 9:
      return 'EM_DEVOLUCAO';
    default:
      throw new Error(`status de pedido da Shein desconhecido: ${status}`);
  }
}

/** "2025-07-25T17:22:11.000+0800" → Date (o fuso sem ":" não é ISO). */
export function dataShein(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function pedidoShein(o: SheinPedido): {
  numeroExterno: string;
  comprador: string;
  produtoNome: string;
  quantidade: number;
  valor: number;
  status: string;
  rastreio: string | null;
  pedidoEm: Date;
  situacao: Situacao;
  itens: ItemPedido[];
  taxas: number | null;
  frete: number | null;
  liquido: number | null;
  extrato: Array<{ rotulo: string; valor: number }> | null;
} {
  const todos = o.orderGoodsInfoList ?? [];
  // Troca: 2 (item que saiu) e 4 (troca desfeita) não são vendidos.
  const ativos = todos.filter((i) => ![2, 4].includes(Number(i.goodsExchangeTag ?? 1)));
  const porSku = new Map<string, ItemPedido>();
  for (const i of ativos) {
    const sku = (i.sellerSku ?? '').trim() || null;
    const variacao =
      i.skuAttribute?.find((a) => a.language === 'PT')?.attrName ??
      i.skuAttribute?.find((a) => a.language === 'US')?.attrName ??
      null;
    const chave = sku ?? `${i.goodsTitle}|${variacao}`;
    const taxa = r2(num(i.commission) + num(i.performanceServiceCharge));
    const atual = porSku.get(chave);
    if (atual) {
      atual.quantidade += 1;
      atual.taxa = r2((atual.taxa ?? 0) + taxa);
    } else {
      porSku.set(chave, {
        sku,
        titulo: i.goodsTitle ?? 'Produto',
        variacao,
        quantidade: 1,
        precoUnit: num(i.sellerCurrencyPrice),
        taxa,
      });
    }
  }
  const bruto = num(o.productTotalPrice);
  const cupom = num(o.storeDiscountTotalPrice);
  const promo = num(o.promotionDiscountTotalPrice);
  const comissao = num(o.totalCommission);
  const servico = num(o.totalPerformanceServiceCharge);
  const frete = num(o.sellerShippingFee);
  const liquido = typeof o.estimatedGrossIncome === 'number' ? r2(o.estimatedGrossIncome) : null;
  const extrato =
    liquido !== null
      ? [
          { rotulo: 'Venda', valor: r2(bruto) },
          ...(cupom ? [{ rotulo: 'Cupom da loja', valor: -r2(cupom) }] : []),
          ...(promo ? [{ rotulo: 'Desconto de campanha', valor: -r2(promo) }] : []),
          ...(comissao ? [{ rotulo: 'Comissão da Shein', valor: -r2(comissao) }] : []),
          ...(servico ? [{ rotulo: 'Taxa de serviço da Shein', valor: -r2(servico) }] : []),
          ...(frete ? [{ rotulo: 'Frete pago pelo comprador', valor: r2(frete) }] : []),
          ...(() => {
            const resto = r2(liquido - (bruto - cupom - promo - comissao - servico + frete));
            return resto ? [{ rotulo: 'Outros ajustes da Shein', valor: resto }] : [];
          })(),
        ]
      : null;
  const status = Number(o.orderStatus);
  return {
    numeroExterno: o.orderNo,
    // A API da Shein não informa o nome do comprador.
    comprador: 'Cliente Shein',
    produtoNome: ativos[0]?.goodsTitle ?? todos[0]?.goodsTitle ?? 'Pedido Shein',
    quantidade: ativos.length,
    valor: r2(bruto - cupom - promo),
    status: String(o.orderStatus ?? ''),
    rastreio: o.packageWaybillList?.find((p) => p.waybillNo)?.waybillNo ?? null,
    pedidoEm: dataShein(o.orderTime) ?? new Date(),
    situacao: situacaoShein(status, !!dataShein(o.pickUpTime)),
    itens: [...porSku.values()],
    taxas: comissao || servico ? r2(comissao + servico) : null,
    frete: frete || null,
    liquido,
    extrato,
  };
}
