/**
 * Origin do frontend pra `targetOrigin` de `postMessage` nos callbacks OAuth.
 *
 * Usa `FRONTEND_URL`; fallback no 1º `CORS_ORIGINS`. NUNCA `'*'` — com `'*'`,
 * qualquer página que abrisse o popup conseguiria capturar o resultado do OAuth
 * (`{ ok }`) via `window.opener`. Restringir ao origin do front fecha isso.
 *
 * Retorna só o origin (scheme+host+porta), sem path.
 */
export function frontendOrigin(): string {
  const raw = process.env.FRONTEND_URL || (process.env.CORS_ORIGINS || '').split(',')[0] || '';
  try {
    return raw ? new URL(raw.trim()).origin : '';
  } catch {
    return '';
  }
}
