// Setup global do vitest (jsdom). Stubs de APIs do browser que o jsdom não
// implementa, mas que componentes usam (ex.: useIsMobile → window.matchMedia).

/**
 * Web Storage: conserta o conflito Node ≥ 25 × jsdom.
 *
 * O Node 25 passou a expor `globalThis.localStorage`/`sessionStorage` nativos.
 * Quando o vitest joga as chaves da window do jsdom no global, essas props
 * NATIVAS ganham do jsdom — e o `localStorage` do Node, sem `--localstorage-file`,
 * é um objeto vazio (sem getItem/setItem/clear). Resultado: `localStorage.clear
 * is not a function` local, enquanto o CI (Node 20, que não tem esses globais)
 * fica verde com a Storage do jsdom.
 *
 * Aqui só restauramos a Storage REAL do jsdom quando a que sobrou está quebrada.
 * Em Node 20 (CI) nada disso executa — a checagem passa direto.
 */
function restaurarStorageDoJsdom(nome: 'localStorage' | 'sessionStorage') {
  const atual = (window as unknown as Record<string, unknown>)[nome] as Storage | undefined;
  const funciona =
    !!atual && typeof atual.getItem === 'function' && typeof atual.setItem === 'function' && typeof atual.clear === 'function';
  if (funciona) return;

  // jsdom guarda as instâncias reais aqui; o getter público é que foi sombreado.
  const doJsdom = (window as unknown as Record<string, unknown>)[`_${nome}`] as Storage | undefined;
  if (!doJsdom || typeof doJsdom.clear !== 'function') {
    throw new Error(
      `test-setup: window.${nome} está quebrado e a Storage do jsdom (window._${nome}) não foi encontrada. ` +
        `Provável incompatibilidade nova entre a versão do Node e a do jsdom.`,
    );
  }
  Object.defineProperty(window, nome, { value: doJsdom, configurable: true, writable: true });
}

if (typeof window !== 'undefined') {
  restaurarStorageDoJsdom('localStorage');
  restaurarStorageDoJsdom('sessionStorage');
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, // default = desktop nos testes
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
