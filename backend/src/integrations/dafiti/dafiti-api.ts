/**
 * API crua do Seller Center da Dafiti (v2) com travas (Léo, 13/11 — card da
 * sessão Dafiti). Ler é livre em /v2; escrever só em anúncio (product-set e
 * variação), sem estoque e sem Full, e o que nasce, nasce INATIVO.
 */
export const CAMINHO_DAFITI = /^\/v2\/[A-Za-z0-9\-_/]+$/;

/** Escrita só em anúncio: product-set, variação (products) e o que fica abaixo deles. */
const ESCRITA_LIBERADA = /^\/v2\/(product-set|product-sets|products?)(\/|$)/;
/** Estoque vem do Magis5; Full (fulfillment) não muda por aqui. */
const ESCRITA_PROIBIDA = /stock|quantit|fulfillment|inventory/i;
/** Criação: POST na coleção de product-set ou de variações de um product-set. */
const CRIACAO = /^\/v2\/product-sets?$|^\/v2\/product-sets?\/\d+\/products$/;

export type MetodoEscrita = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Qualquer chave de estoque, em qualquer nível. */
export function temEstoque(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(temEstoque);
  if (valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(
    ([k, v]) => /stock|quantit|inventory/i.test(k) || temEstoque(v),
  );
}

/** Motivo da recusa, ou null se a escrita pode ir. */
export function recusaEscrita(
  metodo: MetodoEscrita,
  caminho: string,
  corpo: unknown,
): string | null {
  if (!CAMINHO_DAFITI.test(caminho) || caminho.includes('..')) {
    return 'Caminho deve ser /v2/...';
  }
  if (!ESCRITA_LIBERADA.test(caminho)) {
    return 'Escrita só em anúncio (/v2/product-set..., /v2/products...)';
  }
  if (ESCRITA_PROIBIDA.test(caminho))
    return 'Estoque e Full não mudam por aqui (estoque vem do Magis5)';
  if (temEstoque(corpo)) return 'Campo de estoque não passa: estoque vem do Magis5';
  if (temFull(corpo)) return 'shipmentTypeId 1 é o Full (galpão da Dafiti): estamos saindo dele';
  if (metodo === 'DELETE' && !/\/images\/\d+$/.test(caminho)) {
    return 'Apagar só foto; anúncio e variação se desativam (status inactive)';
  }
  return null;
}

/** shipmentTypeId 1 = galpão da Dafiti (Full); 2 = dropshipping (o nosso hoje). */
function temFull(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(temFull);
  if (valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(
    ([k, v]) => (k === 'shipmentTypeId' && Number(v) === 1) || temFull(v),
  );
}

/**
 * Criação nasce inativa e fora do Full: força `status: "inactive"` e, sem
 * `shipmentTypeId`, põe 2 (o padrão da loja pode ser o Full). No product-set o
 * status é o da 1ª variação, que a Dafiti cria junto.
 */
export function forcarInativo(
  metodo: MetodoEscrita,
  caminho: string,
  corpo: unknown,
): { corpo: unknown; ajustes: string[] } {
  if (metodo !== 'POST' || !CRIACAO.test(caminho)) return { corpo, ajustes: [] };
  const ajustes = new Set<string>(['status = inactive (nasce desativado)']);
  const ajustar = (o: unknown) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    const r: Record<string, unknown> = { ...o, status: 'inactive' };
    if (r.shipmentTypeId === undefined) {
      r.shipmentTypeId = 2;
      ajustes.add('shipmentTypeId = 2 (fora do Full)');
    }
    return r;
  };
  const novo = Array.isArray(corpo) ? corpo.map(ajustar) : ajustar(corpo);
  return { corpo: novo, ajustes: [...ajustes] };
}

/** Status da variação vai na URL (?status=): só active, inactive ou deleted. */
export function recusaQuery(query: Record<string, string> | undefined): string | null {
  for (const [k, v] of Object.entries(query ?? {})) {
    if (k !== 'status') return `Parâmetro ${k} não passa na escrita`;
    if (!['active', 'inactive', 'deleted'].includes(v)) return `status inválido: ${v}`;
  }
  return null;
}
