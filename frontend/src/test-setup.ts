// Setup global do vitest (jsdom). Stubs de APIs do browser que o jsdom não
// implementa, mas que componentes usam (ex.: useIsMobile → window.matchMedia).

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
