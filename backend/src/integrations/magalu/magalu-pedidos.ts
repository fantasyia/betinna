import type { ItemPedido } from '@modules/pedidos-marketplace/financeiro';
import type { Situacao } from '@modules/pedidos-marketplace/situacao';
import type { MagaluEntrega, MagaluPedido, MagaluValor } from './magalu.types';

/**
 * Pedido do Magalu (GET /seller/v1/orders) → MarketplaceOrder (14/11). PURO.
 *
 * Valores vêm em inteiro + normalizador (1000 / 100 = R$ 10,00). O pedido tem
 * status próprio (new | approved | cancelled | finished) e cada ENTREGA
 * (pacote) o seu (new | approved | invoiced | shipped | delivered | cancelled |
 * frozen); a situação do app sai das entregas.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Inteiro com normalizador → reais. Sem normalizador, a doc diz centavos. */
export function reais(
  v:
    | { value?: number | null; total?: number | null; normalizer?: number | null }
    | null
    | undefined,
): number | null {
  if (!v) return null;
  const bruto = v.value ?? v.total;
  if (bruto === null || bruto === undefined || !Number.isFinite(Number(bruto))) return null;
  const norm = Number(v.normalizer) > 0 ? Number(v.normalizer) : 100;
  return r2(Number(bruto) / norm);
}

/** Situação do app pelo status do pedido e das entregas. */
export function situacaoMagalu(
  statusPedido: string | null | undefined,
  entregas: MagaluEntrega[],
): Situacao {
  const sp = (statusPedido ?? '').toLowerCase();
  if (entregas.some((e) => (e.returns ?? []).length > 0)) return 'EM_DEVOLUCAO';
  if (sp === 'cancelled') return 'CANCELADO';
  const st = entregas.map((e) => (e.status ?? '').toLowerCase()).filter(Boolean);
  const ativos = st.filter((s) => s !== 'cancelled');
  if (st.length && !ativos.length) return 'CANCELADO';
  if (sp === 'new' && !ativos.some((s) => s !== 'new')) return 'AGUARDANDO_PAGAMENTO';
  if (!ativos.length) return sp === 'finished' ? 'ENTREGUE' : 'A_ENVIAR';
  if (ativos.some((s) => ['new', 'approved', 'invoiced', 'frozen'].includes(s))) return 'A_ENVIAR';
  if (ativos.some((s) => s === 'shipped')) return 'ENVIADO';
  return 'ENTREGUE';
}

function atributos(
  attrs: Array<{ name?: string; value?: string }> | null | undefined,
): string | null {
  const t = (attrs ?? [])
    .map((a) => [a.name, a.value].filter(Boolean).join(': '))
    .filter(Boolean)
    .join(' / ');
  return t || null;
}

/** Dados do pedido pro MarketplaceOrder (custo vem do cadastro, fora daqui). */
export function pedidoMagalu(o: MagaluPedido): {
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
} {
  const entregas = o.deliveries ?? [];
  const ativas = entregas.filter((e) => (e.status ?? '').toLowerCase() !== 'cancelled');
  const fonte = ativas.length ? ativas : entregas;

  // Itens iguais (mesmo SKU) viram uma linha com quantidade.
  const porSku = new Map<string, ItemPedido>();
  let comissaoItens = 0;
  let temComissaoItem = false;
  for (const e of fonte) {
    for (const i of e.items ?? []) {
      const sku = (i.info?.sku ?? '').trim() || null;
      const qtd = Math.max(1, Number(i.quantity ?? 1));
      const preco = reais(i.unit_price) ?? 0;
      const comissao = reais(i.amounts?.commission as MagaluValor | undefined);
      if (comissao !== null) {
        temComissaoItem = true;
        comissaoItens += comissao;
      }
      const chave = sku ?? `${i.info?.name}|${atributos(i.info?.attributes)}`;
      const atual = porSku.get(chave);
      if (atual) {
        atual.quantidade += qtd;
        if (comissao !== null) atual.taxa = r2((atual.taxa ?? 0) + comissao);
      } else {
        porSku.set(chave, {
          sku,
          titulo: i.info?.name ?? 'Produto',
          variacao: atributos(i.info?.attributes),
          quantidade: qtd,
          precoUnit: preco,
          taxa: comissao,
        });
      }
    }
  }
  const itens = [...porSku.values()];
  const somaItens = r2(itens.reduce((s, i) => s + i.precoUnit * i.quantidade, 0));
  const comissaoPedido = reais(o.amounts?.commission);
  const taxas = comissaoPedido ?? (temComissaoItem ? r2(comissaoItens) : null);
  const statusEntregas = [...new Set(entregas.map((e) => e.status).filter(Boolean))];

  return {
    numeroExterno: String(o.code || o.id),
    comprador: o.customer?.name?.trim() || '?',
    produtoNome: itens[0]?.titulo ?? 'Pedido Magalu',
    quantidade: itens.reduce((s, i) => s + i.quantidade, 0),
    valor: somaItens || reais(o.amounts) || 0,
    status: [o.status ?? '?', ...statusEntregas].join(','),
    rastreio: fonte.find((e) => e.shipping?.tracking_url)?.shipping?.tracking_url ?? null,
    pedidoEm: new Date(o.purchased_at || o.created_at || Date.now()),
    situacao: situacaoMagalu(o.status, entregas),
    itens,
    taxas,
  };
}
