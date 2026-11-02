/**
 * Anúncios da Shein (#05, Léo 01/11) — regras PURAS. Hierarquia da Shein:
 * SPU (modelo) → SKC (cor) → SKU (tamanho). Preço é por SKU e por site.
 */

type Multi = Array<{ language?: string; attributeValueName?: string; productName?: string }>;

interface SheinSkuInfo {
  skuCode?: string;
  supplierSku?: string;
  mallState?: number;
  saleAttributeList?: Array<{ attributeValueMultiList?: Multi }>;
  priceInfoList?: Array<{
    site?: string;
    basePrice?: number;
    specialPrice?: number;
    currency?: string;
  }>;
}

interface SheinSkcInfo {
  skcName?: string;
  supplierCode?: string;
  attributeValueMultiList?: Multi;
  shelfStatusInfoList?: Array<{ siteAbbr?: string; shelfStatus?: number }>;
  skcImageInfoList?: Array<{ imageType?: string; imageUrl?: string; sort?: number }>;
  skuInfoList?: SheinSkuInfo[];
}

export interface SheinSpuInfo {
  spuName?: string;
  categoryId?: number;
  supplierCode?: string;
  productMultiNameList?: Multi;
  skcInfoList?: SheinSkcInfo[];
}

/** Texto no idioma pedido; senão o primeiro que vier. */
function texto(m: Multi | undefined, campo: 'attributeValueName' | 'productName'): string | null {
  if (!m?.length) return null;
  return (m.find((x) => x.language === 'pt-br') ?? m[0])[campo] ?? null;
}

/** Detalhe do SPU enxuto: cor por SKC, tamanho/preço/status por SKU. */
export function resumoSpu(s: SheinSpuInfo) {
  return {
    spuName: s.spuName ?? null,
    nome: texto(s.productMultiNameList, 'productName'),
    categoriaId: s.categoryId ?? null,
    codigoVendedor: s.supplierCode ?? null,
    cores: (s.skcInfoList ?? []).map((c) => ({
      skcName: c.skcName ?? null,
      cor: texto(c.attributeValueMultiList, 'attributeValueName'),
      codigoVendedor: c.supplierCode ?? null,
      // 1 = no ar, 0 = fora do ar, por site.
      noAr: Object.fromEntries(
        (c.shelfStatusInfoList ?? []).map((x) => [x.siteAbbr ?? '?', x.shelfStatus === 1]),
      ),
      fotoPrincipal:
        (c.skcImageInfoList ?? []).find((i) => i.imageType === 'MAIN')?.imageUrl ?? null,
      variacoes: (c.skuInfoList ?? []).map((k) => ({
        skuCode: k.skuCode ?? null,
        skuVendedor: k.supplierSku || null,
        tamanho:
          (k.saleAttributeList ?? [])
            .map((a) => texto(a.attributeValueMultiList, 'attributeValueName'))
            .filter(Boolean)
            .join(' / ') || null,
        // 1 à venda · 2 fora de venda
        aVenda: k.mallState === 1,
        precos: (k.priceInfoList ?? []).map((p) => ({
          site: p.site ?? null,
          moeda: p.currency ?? null,
          preco: p.basePrice ?? null,
          precoPromocional: p.specialPrice ? p.specialPrice : null,
        })),
      })),
    })),
  };
}

export interface PrecoPedido {
  skuCode: string;
  preco: number;
  /** null = sem preço promocional (a Shein zera). Obrigatório dizer. */
  precoPromocional: number | null;
  site?: string;
  moeda?: string;
  /** 1 custo · 2 logística · 3 fim de campanha · 4 outros · 5 regra logística (só em aumento). */
  motivoAumento?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Corpo do /product/price/save. Promocional maior ou igual ao preço é recusado antes. */
export function corpoPreco(itens: PrecoPedido[]) {
  for (const i of itens) {
    if (i.precoPromocional !== null && i.precoPromocional >= i.preco) {
      throw new Error(`${i.skuCode}: o preço promocional tem que ser MENOR que o preço`);
    }
  }
  const repetidos = itens.map((i) => i.skuCode).filter((c, k, a) => a.indexOf(c) !== k);
  if (repetidos.length) throw new Error(`SKU repetido: ${[...new Set(repetidos)].join(', ')}`);
  return {
    productPriceList: itens.map((i) => ({
      productCode: i.skuCode,
      site: i.site ?? 'shein-br',
      currencyCode: i.moeda ?? 'BRL',
      shopPrice: r2(i.preco),
      // Sem mandar, a Shein ZERA o promocional — por isso sempre vai explícito.
      specialPrice: i.precoPromocional === null ? 0 : r2(i.precoPromocional),
      riseReason: i.motivoAumento ?? null,
    })),
  };
}

/** Resposta do price/save → aceitos · em revisão · recusados (com o motivo). */
export function resultadoPreco(
  data: Array<{ productCode?: string; success?: boolean; status?: number; message?: string }>,
) {
  const aceitos: string[] = [];
  const emRevisao: string[] = [];
  const recusados: Array<{ skuCode: string; motivo: string }> = [];
  for (const d of data) {
    const sku = d.productCode ?? '?';
    if (d.status === 1 && d.success !== false) aceitos.push(sku);
    else if (d.status === 2) emRevisao.push(sku);
    else recusados.push({ skuCode: sku, motivo: d.message || 'recusado sem motivo' });
  }
  return { aceitos, emRevisao, recusados };
}

/**
 * Consultas liberadas pela ferramenta genérica — só LEITURA ou conversão
 * (nada que mude a loja). Qualquer outro caminho é recusado.
 */
export const CONSULTAS_SHEIN = [
  '/open-api/goods/query-attribute-template',
  '/open-api/goods/query-publish-fill-in-standard',
  '/open-api/goods/query-site-list',
  '/open-api/goods/query-category-tree',
  '/open-api/goods/searchProduct',
  '/open-api/goods/query-document-state',
  '/open-api/goods/product/check-supplierSku-repeated',
  '/open-api/goods/product/check-edit-permission',
  '/open-api/goods/get-custom-attribute-permission-config',
  '/open-api/goods/get-associated-attribute-rules',
  '/open-api/goods/transform-pic',
  '/open-api/goods-specs/check-modify-permission',
  '/open-api/goods-specs/modify-logs/search',
] as const;

export function consultaPermitida(caminho: string): boolean {
  return (CONSULTAS_SHEIN as readonly string[]).includes(caminho);
}
