import type { PrismaService } from '@database/prisma.service';

/**
 * Financeiro do pedido de marketplace (Léo, 24/10: "ver o lucro, 1 por 1").
 * Bruto → taxas → frete da loja → líquido (o que o marketplace repassa) → custo
 * (custo por peça do cadastro) → lucro. Funções PURAS + a resolução do custo.
 */

export interface ItemPedido {
  sku: string | null;
  titulo: string;
  variacao: string | null;
  quantidade: number;
  precoUnit: number;
  /** Comissão do marketplace pro item inteiro (quando ele informa por item). */
  taxa?: number | null;
  /** Preenchido na hora de calcular o custo. */
  custoUnit?: number | null;
}

export interface Financeiro {
  itens: ItemPedido[];
  taxas: number | null;
  frete: number | null;
  liquido: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mercado Livre: comissão por item (sale_fee × qtd); frete = custo do envio pago pela loja. */
export function financeiroMl(
  order: {
    total_amount: number;
    order_items: Array<{
      item: {
        title: string;
        seller_sku?: string | null;
        variation_attributes?: Array<{ name: string; value_name: string }>;
      };
      quantity: number;
      unit_price: number;
      sale_fee?: number | null;
    }>;
  },
  freteLoja: number | null,
): Financeiro {
  const itens: ItemPedido[] = order.order_items.map((i) => ({
    sku: i.item.seller_sku?.trim() || null,
    titulo: i.item.title,
    variacao:
      (i.item.variation_attributes ?? []).map((a) => `${a.name}: ${a.value_name}`).join(' · ') ||
      null,
    quantidade: i.quantity,
    precoUnit: i.unit_price,
    taxa: typeof i.sale_fee === 'number' ? r2(i.sale_fee * i.quantity) : null,
  }));
  const comTaxa = itens.filter((i) => typeof i.taxa === 'number');
  const taxas = comTaxa.length ? r2(comTaxa.reduce((s, i) => s + (i.taxa ?? 0), 0)) : null;
  const liquido = taxas !== null ? r2(order.total_amount - taxas - (freteLoja ?? 0)) : null;
  return { itens, taxas, frete: freteLoja, liquido };
}

/** Shopee: o extrato (escrow) já traz o líquido; taxas = comissão + serviço + transação. */
export function financeiroShopee(
  order: {
    item_list: Array<{
      item_name: string;
      item_sku?: string;
      model_sku?: string;
      model_name?: string;
      model_quantity_purchased: number;
      model_discounted_price: number;
    }>;
  },
  escrow: {
    escrow_amount?: number;
    commission_fee?: number;
    service_fee?: number;
    seller_transaction_fee?: number;
    actual_shipping_fee?: number;
    shopee_shipping_rebate?: number;
    buyer_paid_shipping_fee?: number;
  } | null,
): Financeiro {
  const itens: ItemPedido[] = order.item_list.map((i) => ({
    sku: (i.model_sku || i.item_sku || '').trim() || null,
    titulo: i.item_name,
    variacao: i.model_name?.trim() || null,
    quantidade: i.model_quantity_purchased,
    precoUnit: i.model_discounted_price,
  }));
  if (!escrow || typeof escrow.escrow_amount !== 'number') {
    return { itens, taxas: null, frete: null, liquido: null };
  }
  const taxas = r2(
    (escrow.commission_fee ?? 0) + (escrow.service_fee ?? 0) + (escrow.seller_transaction_fee ?? 0),
  );
  const frete = r2(
    Math.max(
      0,
      (escrow.actual_shipping_fee ?? 0) -
        (escrow.shopee_shipping_rebate ?? 0) -
        (escrow.buyer_paid_shipping_fee ?? 0),
    ),
  );
  return { itens, taxas, frete, liquido: r2(escrow.escrow_amount) };
}

/**
 * Custo dos itens pelo cadastro: 1º o vínculo manual (kit = N × variação),
 * senão a variação com esse SKU (ou SKU secundário). Custo da variação =
 * custoPorPeca da linha do modelo. Item sem custo → `completo: false`.
 */
export async function custoDosItens(
  prisma: Pick<PrismaService, 'skuMarketplaceVinculo' | 'catalogoVariacao'>,
  empresaId: string,
  plataforma: string,
  itens: ItemPedido[],
): Promise<{ itens: ItemPedido[]; custo: number | null; completo: boolean }> {
  let total = 0;
  let completo = itens.length > 0;
  const saida: ItemPedido[] = [];
  for (const it of itens) {
    let custoUnit: number | null = null;
    if (it.sku) {
      const v = await prisma.skuMarketplaceVinculo.findUnique({
        where: { empresaId_plataforma_sku: { empresaId, plataforma, sku: it.sku } },
      });
      const variacao = await prisma.catalogoVariacao.findFirst({
        where: v
          ? { id: v.variacaoId, modelo: { empresaId } }
          : { modelo: { empresaId }, OR: [{ sku: it.sku }, { skuSecundario: it.sku }] },
        select: { modeloLinha: { select: { custoPorPeca: true } } },
      });
      const c = variacao?.modeloLinha?.custoPorPeca;
      if (c !== null && c !== undefined) custoUnit = r2(Number(c) * (v?.quantidade ?? 1));
    }
    if (custoUnit === null) completo = false;
    else total += custoUnit * it.quantidade;
    saida.push({ ...it, custoUnit });
  }
  return { itens: saida, custo: total > 0 || completo ? r2(total) : null, completo };
}

/** Lucro e margem (sobre o bruto) — null quando falta líquido ou custo. */
export function lucroDoPedido(p: {
  valor: number;
  liquido: number | null;
  custo: number | null;
  custoCompleto: boolean | null;
}): { lucro: number | null; margemPct: number | null } {
  if (p.liquido === null || p.custo === null || !p.custoCompleto)
    return { lucro: null, margemPct: null };
  const lucro = r2(p.liquido - p.custo);
  return { lucro, margemPct: p.valor > 0 ? Math.round((lucro / p.valor) * 1000) / 10 : null };
}
