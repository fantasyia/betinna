/**
 * Modo interno da vitrine (#04/Léo, 19/10): o aparelho da equipe abre UMA vez
 * o link `?interno=<código>` e fica marcado. Com a marca (ou com um IP da
 * equipe), a vitrine não carrega o pixel do Meta nem o Google Ads, e o GA4
 * recebe a visita como tráfego interno.
 */

const chave = (slug: string) => `vitrine:interno:${slug}`;

/** Guarda o código do link (se veio na URL) e tira ele da barra. Devolve o código guardado. */
export function capturarCodigoInterno(slug: string, href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return codigoInterno(slug);
  }
  const c = url.searchParams.get('interno');
  if (c && /^[0-9a-f]{24}$/.test(c)) {
    try {
      localStorage.setItem(chave(slug), c);
    } catch {
      /* sem armazenamento: vale só nesta visita */
      return c;
    }
    url.searchParams.delete('interno');
    try {
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {
      /* fora do navegador */
    }
  }
  return codigoInterno(slug);
}

export function codigoInterno(slug: string): string | null {
  try {
    return localStorage.getItem(chave(slug));
  } catch {
    return null;
  }
}

/** Desmarca o aparelho (link `?interno=sair`). */
export function sairDoModoInterno(slug: string, href: string): boolean {
  try {
    if (new URL(href).searchParams.get('interno') !== 'sair') return false;
    localStorage.removeItem(chave(slug));
    return true;
  } catch {
    return false;
  }
}
