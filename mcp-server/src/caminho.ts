/**
 * Segmento de path e guarda do caminho — auditoria 13/09/2026, achado H-2.
 *
 * Os ids eram interpolados crus no path (`/fluxos/${fluxoId}/desarquivar`).
 * O `fetch` normaliza a URL pela spec WHATWG: `"cm123/ativar#"` vira
 * `/fluxos/cm123/ativar` (o `#` corta o resto) e `../../` sobe de módulo. Um
 * id vindo de conteúdo observado (card, lead) ativava fluxo ou apagava fluxo
 * ATIVO pela porta dos fundos, com a tool respondendo sucesso.
 *
 * Duas camadas, de propósito: `seg()` em cada call site (valida + encoda) e
 * `assertCaminhoSeguro()` no `request()` (se algum site escapar, o path que
 * normaliza diferente do que foi escrito é recusado antes do fetch).
 */

/** Formato aceito num segmento de path: cuid/uuid/número/slug. Nada de `/`, `#`, `?`, `..`. */
const SEGMENTO_OK = /^[A-Za-z0-9_.:@-]{1,200}$/;

export function seg(valor: string | number): string {
  const s = String(valor);
  if (!SEGMENTO_OK.test(s) || s === '.' || s === '..') {
    throw new Error(`id inválido no caminho: "${s.slice(0, 60)}"`);
  }
  return encodeURIComponent(s);
}

/**
 * Recusa caminho que a URL normalizaria pra outro lugar. Compara o pathname
 * escrito com o pathname que `new URL` produz — se diferem, alguém injetou
 * `#`, `..`, `//` ou controle.
 */
export function assertCaminhoSeguro(base: string, path: string): URL {
  if (!path.startsWith('/')) throw new Error(`caminho relativo recusado: "${path.slice(0, 80)}"`);
  const [escrito] = path.split('?', 1);
  if (escrito.includes('#') || /(^|\/)\.\.?(\/|$)/.test(escrito) || escrito.includes('//')) {
    throw new Error(`caminho suspeito recusado: "${path.slice(0, 80)}"`);
  }
  const url = new URL(`${base}${path}`);
  const basePath = new URL(base).pathname.replace(/\/$/, '');
  if (url.pathname !== `${basePath}${escrito}`) {
    throw new Error(`caminho normalizou pra outro lugar: "${path.slice(0, 80)}" → ${url.pathname}`);
  }
  return url;
}
