/**
 * Vite config — Betinna.ai frontend.
 *
 * Hardening:
 *  - `build.sourcemap = false` em produção (não vazar source código)
 *  - Code splitting por rota via React.lazy nas páginas
 *  - PORT dinâmico via process.env.PORT (Railway injeta)
 *  - Bundle alvo < 200KB gzipped (verificar com `vite build --report`)
 *
 * PWA (Progressive Web App):
 *  - manifest.webmanifest gerado automaticamente
 *  - service worker via workbox em modo `injectManifest` precache
 *  - App pode ser instalado no celular (home screen) e abre fullscreen
 *  - Funciona offline pra assets estáticos (HTML/CSS/JS)
 *  - APIs **não** são cacheadas (NetworkOnly por padrão pra /api/v1/*)
 *    → preserva multi-tenant + segurança (não cacheia dados sensíveis)
 *
 * Update flow: quando novo deploy sai, service worker detecta e mostra
 * "Nova versão disponível, recarregar?" via evento `pwa:needRefresh`
 * (capturado em main.tsx).
 */
declare const _default: import("vite").UserConfig;
export default _default;
