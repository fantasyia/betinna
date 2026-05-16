/**
 * Constantes de provedores externos (IPs, hostnames, valores fixos da API).
 * Mantém valores fora do código para facilitar atualização.
 */

/**
 * IPs do Mercado Livre que enviam webhooks. Como ML não publica HMAC oficial,
 * a IP whitelist é a única proteção contra spoofing.
 *
 * Documentação ML 2024: https://developers.mercadolibre.com.br/pt_br/notificacoes
 *
 * IMPORTANTE: ML pode renumerar sem aviso prévio. Manter sincronizado.
 * Override em runtime via env `ML_WEBHOOK_IP_WHITELIST` (comma-separated).
 */
export const ML_WEBHOOK_IPS_DEFAULT: ReadonlyArray<string> = Object.freeze([
  '54.88.218.97',
  '18.215.140.160',
  '18.213.114.129',
  '18.206.34.84',
]);

/**
 * Normaliza IPv4-mapped IPv6 (`::ffff:1.2.3.4`) para IPv4 (`1.2.3.4`).
 * Necessário porque alguns runtimes (Railway via Node 24) expõem o IP nessa
 * forma e a comparação direta com whitelist falha.
 */
export function normalizeIp(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}
