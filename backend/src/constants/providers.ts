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
  // 14/11/2026: os logs da api mostravam o ML notificando de 152.233.30.101,
  // .102 e .104, e TODA notificação recusada por IP ("Webhook ML rejeitado por
  // IP") — nenhuma mensagem pós-venda entrava pelo webhook. Faixa como CIDR.
  '152.233.30.0/24',
]);

/** IPv4 em inteiro (sem sinal); null se não for IPv4 válido. */
function ipv4ParaInt(ip: string): number | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const parte of p) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    const v = Number(parte);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/**
 * O IP está na whitelist? Cada entrada é um IP exato ou uma faixa CIDR IPv4
 * (`a.b.c.d/nn`).
 */
export function ipNaWhitelist(ip: string, whitelist: ReadonlyArray<string>): boolean {
  if (!ip) return false;
  const alvo = ipv4ParaInt(ip);
  return whitelist.some((entrada) => {
    const [base, bitsTxt] = entrada.split('/');
    if (bitsTxt === undefined) return entrada === ip;
    const bits = Number(bitsTxt);
    const rede = ipv4ParaInt(base);
    if (alvo === null || rede === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      return false;
    }
    if (bits === 0) return true;
    const desloc = 2 ** (32 - bits);
    return Math.floor(alvo / desloc) === Math.floor(rede / desloc);
  });
}

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
