import type { RedisOptions } from 'ioredis';

/**
 * Opções padronizadas para QUALQUER conexão Redis no projeto.
 *
 * Centraliza dois pontos críticos:
 *  1. `REDIS_URL` é a única fonte da verdade (passado pelo caller)
 *  2. Quando rodando em Railway production (`RAILWAY_ENVIRONMENT === 'production'`),
 *     aplica TLS com `rejectUnauthorized: false`. Railway expõe Redis interno
 *     via `rediss://` mas o cert é self-signed do edge — precisa desativar
 *     validação estrita pra conectar.
 *
 * Use em TODAS as instâncias `new IORedis(url, opts)` e em `BullModule.forRootAsync`.
 *
 * @param overrides options específicas do caller (maxRetriesPerRequest etc.)
 * @returns RedisOptions com TLS aplicado quando apropriado
 */
export function buildRedisOptions(overrides: RedisOptions = {}): RedisOptions {
  const baseOptions: RedisOptions = {
    // Sane defaults — sobreescrevíveis via overrides
    enableReadyCheck: true,
    lazyConnect: false,
    ...overrides,
  };

  // Railway production: TLS obrigatório, cert self-signed do edge → relaxa validação.
  // Em outros ambientes (local dev, staging custom, AWS ElastiCache com cert válido)
  // não mexemos — o ioredis infere TLS automaticamente do schema `rediss://`.
  if (process.env.RAILWAY_ENVIRONMENT === 'production') {
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
    ...buildRedisOptions(overrides),
  };
}
