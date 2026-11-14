/**
 * Travas do passthrough `magalu_api` (14/11). PURO — testado sem rede.
 *
 *  - LER (GET): livre em /seller/v0|v1/... (anúncio, pedido, SAC) e em
 *    /v0/questions | /v0/conversations (perguntas e chat);
 *  - ESCREVER: só anúncio — SKU (criar POST /seller/v1/portfolios/skus,
 *    alterar PUT/PATCH /seller/v1/portfolios/skus/{sku}) e preço
 *    (POST/PATCH /seller/v1/portfolios/prices/{sku});
 *  - estoque NUNCA (vem do Magis5): rota de stock/warehouse e qualquer chave de
 *    estoque no corpo são recusadas; Full (`fulfillment: true`) também;
 *  - SKU novo nasce `active: false` (fora do ar até alguém ligar);
 *  - DELETE, pedido, nota, entrega, SAC, pergunta e chat não escrevem por aqui.
 */
export const CAMINHO_MAGALU =
  /^\/(seller\/v[01]|v0\/(questions|conversations))(\/[A-Za-z0-9\-_.]+)*$/;

export type MetodoEscritaMagalu = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const SKUS_COLECAO = /^\/seller\/v1\/portfolios\/skus$/;
const SKU_UM = /^\/seller\/v1\/portfolios\/skus\/[A-Za-z0-9\-_.]+$/;
const PRECO_UM = /^\/seller\/v1\/portfolios\/prices\/[A-Za-z0-9\-_.]+$/;
const ROTA_ESTOQUE = /stock|warehouse|estoque/i;
const CHAVE_ESTOQUE = /stock|warehouse|estoque|quantit/i;

/** Caminho aceito pra leitura e escrita (sem `..`). */
export function caminhoValido(caminho: string): boolean {
  return CAMINHO_MAGALU.test(caminho) && !caminho.includes('..');
}

/** Qualquer chave de estoque, em qualquer nível. */
export function temEstoque(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(temEstoque);
  if (valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(([k, v]) => CHAVE_ESTOQUE.test(k) || temEstoque(v));
}

/** `fulfillment: true` em qualquer nível = Full do Magalu. */
export function temFull(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(temFull);
  if (valor === null || typeof valor !== 'object') return false;
  return Object.entries(valor).some(([k, v]) => (k === 'fulfillment' && v === true) || temFull(v));
}

/** Motivo da recusa da escrita, ou null se pode ir. */
export function recusaEscrita(
  metodo: MetodoEscritaMagalu,
  caminho: string,
  corpo: unknown,
): string | null {
  if (!caminhoValido(caminho)) {
    return 'Caminho deve ser /seller/v1/..., /seller/v0/..., /v0/questions... ou /v0/conversations...';
  }
  if (ROTA_ESTOQUE.test(caminho)) return 'Estoque vem do Magis5: rota de estoque não escreve';
  if (metodo === 'DELETE') return 'Apagar não passa por aqui; desative o SKU (active: false)';
  const liberado =
    (SKUS_COLECAO.test(caminho) && metodo === 'POST') ||
    (SKU_UM.test(caminho) && (metodo === 'PUT' || metodo === 'PATCH')) ||
    (PRECO_UM.test(caminho) && (metodo === 'POST' || metodo === 'PATCH'));
  if (!liberado) {
    return (
      'Escrita só em anúncio: POST /seller/v1/portfolios/skus, PUT|PATCH ' +
      '/seller/v1/portfolios/skus/{sku}, POST|PATCH /seller/v1/portfolios/prices/{sku}'
    );
  }
  if (temEstoque(corpo)) return 'Campo de estoque não passa: estoque vem do Magis5';
  if (temFull(corpo)) return 'Full (fulfillment: true) não muda por aqui';
  return null;
}

/** SKU novo nasce desativado (`active: false`). Só mexe no POST da coleção. */
export function forcarInativo(
  metodo: MetodoEscritaMagalu,
  caminho: string,
  corpo: unknown,
): { corpo: unknown; ajustes: string[] } {
  if (metodo !== 'POST' || !SKUS_COLECAO.test(caminho)) return { corpo, ajustes: [] };
  const ajustar = (o: unknown) =>
    o && typeof o === 'object' && !Array.isArray(o) ? { ...o, active: false } : o;
  return {
    corpo: Array.isArray(corpo) ? corpo.map(ajustar) : ajustar(corpo ?? {}),
    ajustes: ['active = false (SKU nasce desativado)'],
  };
}
