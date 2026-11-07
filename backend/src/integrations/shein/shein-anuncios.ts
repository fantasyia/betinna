/**
 * Anúncios da Shein (#05, Léo 01/11) — regras PURAS. Hierarquia da Shein:
 * SPU (modelo) → SKC (cor) → SKU (tamanho). Preço é por SKU e por site.
 */

type Multi = Array<{
  language?: string;
  attributeValueName?: string;
  productName?: string;
  productDesc?: string;
}>;

interface SheinSkuInfo {
  skuCode?: string;
  supplierSku?: string;
  mallState?: number;
  saleAttributeList?: Array<{ attributeId?: number; attributeValueMultiList?: Multi }>;
  priceInfoList?: Array<{
    site?: string;
    basePrice?: number;
    specialPrice?: number;
    currency?: string;
  }>;
}

interface SheinSkcInfo {
  skcName?: string;
  attributeId?: number;
  supplierCode?: string;
  attributeValueMultiList?: Multi;
  shelfStatusInfoList?: Array<{ siteAbbr?: string; shelfStatus?: number }>;
  skcImageInfoList?: Array<{ imageType?: string; imageUrl?: string; sort?: number }>;
  skuInfoList?: SheinSkuInfo[];
}

export interface SheinAtributoLido {
  attributeId?: number;
  attributeValueId?: number | null;
  attributeValue?: string | number | null;
  attributeMultiList?: Array<{ attributeName?: string }>;
  attributeValueMultiList?: Multi;
}

export interface SheinSpuInfo {
  spuName?: string;
  categoryId?: number;
  supplierCode?: string;
  productMultiNameList?: Multi;
  productMultiDescList?: Multi;
  productAttributeInfoList?: SheinAtributoLido[];
  dimensionAttributeInfoList?: unknown[];
  spuImageInfoList?: unknown[] | null;
  skcInfoList?: SheinSkcInfo[];
}

/** Texto no idioma pedido; senão o primeiro que vier. */
function texto(
  m: Multi | undefined,
  campo: 'attributeValueName' | 'productName' | 'productDesc',
): string | null {
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
  /**
   * null/ausente = sem promocional (vai 0). Na Shein BR (autooperação, testes
   * de 02/11) o especial VIRA o preço de venda e o shopPrice é descartado: lá
   * só existe um preço, então o normal é mandar só o `preco`.
   */
  precoPromocional?: number | null;
  site?: string;
  moeda?: string;
  /** 1 custo · 2 logística · 3 fim de campanha · 4 outros · 5 regra logística (só em aumento). */
  motivoAumento?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Corpo do /product/price/save. Promocional maior ou igual ao preço é recusado antes. */
export function corpoPreco(itens: PrecoPedido[]) {
  for (const i of itens) {
    if (i.precoPromocional != null && i.precoPromocional >= i.preco) {
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
      specialPrice: i.precoPromocional == null ? 0 : r2(i.precoPromocional),
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
  // Campanhas e preço de varejo sugerido (#02, 02/11) — leitura.
  '/open-api/campaigns/campaign-list',
  '/open-api/campaigns/campaign-detail',
  '/open-api/campaigns/registrable-product-list',
  '/open-api/campaigns/registration-records',
  '/open-api/goods-recommend-retail-price/search',
  '/open-api/goods/query-recommend-retail-price-rule',
  '/open-api/goods-recommend-retail-price-audit/search',
] as const;

export function consultaPermitida(caminho: string): boolean {
  return (CONSULTAS_SHEIN as readonly string[]).includes(caminho);
}

/**
 * Escritas liberadas fora do preço/edição (#02, 02/11): inscrever e cancelar
 * em campanha e enviar preço de varejo sugerido (o "de R$" riscado, com
 * revisão da Shein). MEXEM NA LOJA — só com o OK do Léo pro plano exato.
 */
export const ESCRITAS_SHEIN = [
  '/open-api/campaigns/register-campaign',
  '/open-api/campaigns/cancel-registration',
  '/open-api/goods-recommend-retail-price/batch-save',
] as const;

export function escritaPermitida(caminho: string): boolean {
  return (ESCRITAS_SHEIN as readonly string[]).includes(caminho);
}

// ── Edição de anúncio (Léo, 07/11) ─────────────────────────────────────────

/** Atributo no formato do partialEdit (product_attribute_list). */
export interface AtributoEnvio {
  attribute_id: number;
  attribute_value_id?: number;
  attribute_extra_value?: string;
}

/**
 * Atributos DO PRODUTO lidos do spu-info. A Shein mistura neles os atributos de
 * venda (cor e tamanho), que o partialEdit recusa: saem pelo id usado nas cores e
 * nos tamanhos do próprio anúncio.
 */
export function atributosProduto(s: SheinSpuInfo): AtributoEnvio[] {
  const venda = new Set<number>();
  for (const c of s.skcInfoList ?? []) {
    if (c.attributeId) venda.add(c.attributeId);
    for (const k of c.skuInfoList ?? []) {
      for (const a of k.saleAttributeList ?? []) if (a.attributeId) venda.add(a.attributeId);
    }
  }
  return (s.productAttributeInfoList ?? [])
    .filter((a) => a.attributeId && !venda.has(a.attributeId))
    .map((a) => ({
      attribute_id: a.attributeId as number,
      ...(a.attributeValueId ? { attribute_value_id: a.attributeValueId } : {}),
      ...(a.attributeValue !== null && a.attributeValue !== undefined && a.attributeValue !== ''
        ? { attribute_extra_value: String(a.attributeValue) }
        : {}),
    }));
}

/**
 * Lista inteira pro partialEdit: o atributo trocado sai com todos os valores e
 * entra só com os novos; o removido sai; o resto vai igual ao lido.
 */
export function mesclarAtributos(
  atual: AtributoEnvio[],
  trocar: AtributoEnvio[],
  remover: number[],
): AtributoEnvio[] {
  const presentes = new Set(atual.map((a) => a.attribute_id));
  const faltando = remover.filter((id) => !presentes.has(id));
  if (faltando.length) throw new Error(`Atributo fora do anúncio: ${faltando.join(', ')}`);
  const sai = new Set([...remover, ...trocar.map((t) => t.attribute_id)]);
  return [...atual.filter((a) => !sai.has(a.attribute_id)), ...trocar];
}

/** Edição de anúncio não leva estoque nem preço: chave assim em qualquer nível recusa. */
export function temEstoqueOuPreco(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(temEstoqueOuPreco);
  if (valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(
    ([k, v]) => /stock|price|quantity|inventory/i.test(k) || temEstoqueOuPreco(v),
  );
}

/** Ficha do anúncio pro que as rotas de edição trocam. */
export function fichaSpu(s: SheinSpuInfo) {
  return {
    spuName: s.spuName ?? null,
    titulo: texto(s.productMultiNameList, 'productName'),
    descricao: texto(s.productMultiDescList, 'productDesc'),
    atributos: atributosProduto(s),
    tabela: s.dimensionAttributeInfoList ?? [],
    fotos: s.spuImageInfoList ?? [],
    cores: (s.skcInfoList ?? []).map((c) => ({
      skcName: c.skcName ?? null,
      cor: texto(c.attributeValueMultiList, 'attributeValueName'),
      fotos: c.skcImageInfoList ?? [],
    })),
  };
}

/** Resposta do partialEdit: a Shein aceita pra revisão ou barra na pré-validação. */
export function resultadoEdicao(
  info: {
    success?: boolean;
    version?: string;
    pre_valid_result?: Array<{ form_name?: string; messages?: string[] }> | null;
  } | null,
) {
  const bloqueios = (info?.pre_valid_result ?? []).flatMap((p) =>
    (p.messages ?? []).map((m) => (p.form_name ? `${p.form_name}: ${m}` : m)),
  );
  return {
    enviado: info?.success !== false && bloqueios.length === 0,
    versao: info?.version ?? null,
    bloqueios,
  };
}

/** Foto já hospedada na Shein não precisa de conversão. */
export function fotoDaShein(url: string): boolean {
  return /^https?:\/\/[^/]*(ltwebstatic\.com|shein\.com|sheincorp\.cn)\//i.test(url);
}
