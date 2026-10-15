import type { Carrinho, ModeloPub } from './calculo';

/**
 * Recuperador de carrinho na vitrine (Léo, 14/10). PURO (menos o storage).
 * - `?r=<ref>`: veio pelo link do WhatsApp — a vitrine vai salvando o carrinho
 *   no servidor ligado a esse lead (o servidor confere a assinatura do ref).
 * - `?c=<token>`: o link de recuperar — restaura o carrinho e os dados.
 */

export function paramsDoLink(href: string): { ref: string | null; token: string | null } {
  try {
    const u = new URL(href);
    return { ref: u.searchParams.get('r'), token: u.searchParams.get('c') };
  } catch {
    return { ref: null, token: null };
  }
}

/** Itens salvos ({corId, tamanhoId, quantidade}) → carrinho da vitrine. Cor que sumiu fica de fora. */
export function carrinhoDosItens(
  itens: Array<{ corId: string; tamanhoId: string; quantidade: number }>,
  modelos: Pick<ModeloPub, 'id' | 'cores'>[],
): Carrinho {
  const modeloDaCor = new Map<string, string>();
  for (const m of modelos) for (const c of m.cores) modeloDaCor.set(c.id, m.id);
  const out: Carrinho = {};
  for (const i of itens) {
    const m = modeloDaCor.get(i.corId);
    if (!m || !(i.quantidade > 0)) continue;
    out[m] ??= {};
    out[m][i.corId] ??= {};
    out[m][i.corId][i.tamanhoId] = (out[m][i.corId][i.tamanhoId] ?? 0) + i.quantidade;
  }
  return out;
}

/** O link sem o `?c=` (pra recarregar a página não restaurar de novo por cima). */
export function semToken(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete('c');
    return u.pathname + (u.search ? u.search : '') + u.hash;
  } catch {
    return href;
  }
}

const chaveRef = (slug: string) => `vitrine:ref:${slug}`;

export function guardarRef(slug: string, ref: string) {
  try {
    localStorage.setItem(chaveRef(slug), ref);
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

export function lerRef(slug: string): string | null {
  try {
    return localStorage.getItem(chaveRef(slug));
  } catch {
    return null;
  }
}
