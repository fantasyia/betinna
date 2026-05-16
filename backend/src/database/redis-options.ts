import type { RedisOptions } from 'ioredis';

/**
 * Opções padronizadas para QUALQUER conexão Redis no projeto.
 *
 * Detecção de TLS é feita pelo **scheme da URL**, NÃO por variável de ambiente:
 *   - `rediss://...`  → aplica `tls: { rejectUnauthorized: false }` (TLS-enabled)
 *   - `redis://...`   → NÃO aplica TLS (plaintext)
 *   - URL inválida    → não aplica TLS (deixa o ioredis errar como sempre)
 *
 * Por que pelo scheme e não por env:
 *  - Railway PostgreSQL/Redis interno usa `redis://` (mesma região, sem TLS)
 *  - Railway/Upstash external usa `rediss://` (TLS exposto)
 *  - Self-hosted/local: o operador define o scheme correto
 *  - AWS ElastiCache pode ir nos 2 modos — controle vem da URL
 *
 * `rejectUnauthorized: false` quando TLS é necessário pra cobrir certs self-signed
 * (Railway edge, Upstash em alguns planos). Cert válido também passa.
 *
 * Use em TODAS as instâncias `new IORedis(url, opts)` e em `BullModule.forRootAsync`.
 *
 * @param redisUrl URL completa do Redis (vem do env)
 * @param overrides options específicas do caller (maxRetriesPerRequest etc.)
 * @returns RedisOptions com TLS aplicado APENAS se URL começa com `rediss://`
 */
export function buildRedisOptions(redisUrl: string, overrides: RedisOptions = {}): RedisOptions {
  const baseOptions: RedisOptions = {
    // Sane defaults — sobreescrevíveis via overrides
    enableReadyCheck: true,
    lazyConnect: false,
    ...overrides,
  };

  // Detecta TLS pelo scheme da URL (não por env var).
  // Aceita whitespace inicial e case-insensitive — defensivo a inputs sujos.
  if (isTlsUrl(redisUrl)) {
    baseOptions.tls = { rejectUnauthorized: false };
  }

  return baseOptions;
}

/**
 * Variante para BullMQ — usa o shape `connection: { url, ...opts }` esperado
 * pelo `@nestjs/bullmq` em `BullModule.forRootAsync({ connection })`.
 *
 * @param redisUrl URL completa do Redis (vem do env)
 * @param overrides options específicas
 */
export function buildBullMqConnection(
  redisUrl: string,
  overrides: RedisOptions = {},
): { url: string } & RedisOptions {
  return {
    url: redisUrl,
    ...buildRedisOptions(redisUrl, overrides),
  };
}

/**
 * Helper exportado para teste — detecta se URL exige TLS.
 *
 * @example
 *   isTlsUrl('redis://localhost:6379')                    // false
 *   isTlsUrl('rediss://default:pwd@host.upstash.io:6379') // true
 *   isTlsUrl('REDISS://...')                              // true (case-insensitive)
 *   isTlsUrl('')                                          // false
 */
export function isTlsUrl(redisUrl: string): boolean {
  if (typeof redisUrl !== 'string') return false;
  return redisUrl.trim().toLowerCase().startsWith('rediss://');
}
