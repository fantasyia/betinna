import type { ItemPedido } from '@modules/pedidos-marketplace/financeiro';
import type { Situacao } from '@modules/pedidos-marketplace/situacao';

/**
 * Pedido da Dafiti (Seller Center API v2) → pedido de marketplace do app
 * (Léo, 25/10: "todos os canais gerenciados pelo app"). PURO.
 *
 * Na Dafiti cada ITEM é 1 unidade com status próprio (o pedido não tem status
 * único). Comissão = paidCommission por item; o que cai pra loja =
 * salesDueAmount (quando a API manda).
 */

export interface DafitiItem {
  id: number;
  status: string;
  paidPrice?: number | null;
  unitPrice?: number | null;
  paidCommission?: number | null;
  salesDueAmount?: number | null;
  product?: { name?: string; sellerSku?: string; sku?: string; variation?: string } | null;
  shipment?: { trackingCode?: string | null } | null;
}

export interface DafitiPedido {
  id: number;
  number: string;
  createdAt: string;
  customer?: { firstName?: string; lastName?: string } | null;
  grandTotal?: number | null;
  itemCount?: number | null;
  items?: DafitiItem[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Situação do pedido pelos itens: devolução em qualquer item vence; depois o
 * estado "menos avançado" dos itens ativos (cancelado só se TODOS cancelaram).
 */
export function situacaoDafiti(status: string[]): Situacao {
  const s = status.map((x) => x.toLowerCase());
  if (s.some((x) => x.startsWith('return') || x === 'returned')) return 'EM_DEVOLUCAO';
  const ativos = s.filter((x) => x !== 'canceled');
  if (!ativos.length) return s.length ? 'CANCELADO' : 'A_ENVIAR';
  if (ativos.some((x) => x === 'payment_pending')) return 'AGUARDANDO_PAGAMENTO';
  if (
    ativos.some((x) =>
      ['pending', 'ready_to_ship', 'shipment_information_pending', 'failed'].includes(x),
    )
  ) {
    return 'A_ENVIAR';
  }
  if (ativos.some((x) => x === 'shipped')) return 'ENVIADO';
  return 'ENTREGUE';
}

/** Dados do pedido pro MarketplaceOrder (sem o custo — esse vem do cadastro). */
export function pedidoDafiti(o: DafitiPedido): {
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
  liquido: number | null;
  extrato: Array<{ rotulo: string; valor: number }> | null;
} {
  const itens = o.items ?? [];
  const ativos = itens.filter((i) => i.status !== 'canceled');
  const nome =
    [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ').trim() || '?';
  // Itens iguais (mesmo SKU) viram uma linha com quantidade.
  const porSku = new Map<string, ItemPedido>();
  for (const i of ativos) {
    const sku = (i.product?.sellerSku || i.product?.sku || '').trim() || null;
    const chave = sku ?? `${i.product?.name}|${i.product?.variation}`;
    const preco = Number(i.paidPrice ?? i.unitPrice ?? 0);
    const atual = porSku.get(chave);
    if (atual) {
      atual.quantidade += 1;
      atual.taxa = r2((atual.taxa ?? 0) + Number(i.paidCommission ?? 0));
    } else {
      porSku.set(chave, {
        sku,
        titulo: i.product?.name ?? 'Produto',
        variacao: i.product?.variation?.trim() || null,
        quantidade: 1,
        precoUnit: preco,
        taxa:
          i.paidCommission === null || i.paidCommission === undefined
            ? null
            : r2(Number(i.paidCommission)),
      });
    }
  }
  const valor = r2(ativos.reduce((s, i) => s + Number(i.paidPrice ?? i.unitPrice ?? 0), 0));
  const temComissao = ativos.some((i) => typeof i.paidCommission === 'number');
  const taxas = temComissao
    ? r2(ativos.reduce((s, i) => s + Number(i.paidCommission ?? 0), 0))
    : null;
  const temRepasse =
    ativos.length > 0 &&
    ativos.every((i) => typeof i.salesDueAmount === 'number' && i.salesDueAmount > 0);
  const liquido = temRepasse ? r2(ativos.reduce((s, i) => s + Number(i.salesDueAmount), 0)) : null;
  const extrato =
    liquido !== null
      ? [
          { rotulo: 'Venda', valor },
          ...(taxas ? [{ rotulo: 'Comissão da Dafiti', valor: -taxas }] : []),
          ...(() => {
            const resto = r2(liquido - (valor - (taxas ?? 0)));
            return resto ? [{ rotulo: 'Outros ajustes da Dafiti', valor: resto }] : [];
          })(),
        ]
      : null;
  return {
    numeroExterno: String(o.number || o.id),
    comprador: nome,
    produtoNome: ativos[0]?.product?.name ?? itens[0]?.product?.name ?? 'Pedido Dafiti',
    quantidade: ativos.length,
    valor: valor || Number(o.grandTotal ?? 0),
    status: [...new Set(itens.map((i) => i.status))].join(','),
    rastreio: ativos.find((i) => i.shipment?.trackingCode)?.shipment?.trackingCode ?? null,
    pedidoEm: new Date(o.createdAt),
    situacao: situacaoDafiti(itens.map((i) => i.status)),
    itens: [...porSku.values()],
    taxas,
    liquido,
    extrato,
  };
}
