/**
 * Vite config — Betinna.ai frontend (Sprint 4 FIX 5).
 *
 * Sprint 4 hardening:
 *  - `build.sourcemap = false` em produção (não vazar source código)
 *  - Code splitting por rota via React.lazy nas páginas
 *  - PORT dinâmico via process.env.PORT (Railway injeta)
 *  - Bundle alvo < 200KB gzipped (verificar com `vite build --report`)
 */
declare const _default: import("vite").UserConfig;
export default _default;
