import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { EnvService } from '@config/env.service';
import { buildRedisOptions } from './redis-options';

/**
 * Cliente Redis compartilhado.
 *
 * Singleton injetável que reusa a connection BullMQ (REDIS_URL).
 * Usado para:
 *  - Cache do AuthGuard (auth:user:{userId})
 *  - Locks de cron (cron:lock:{name})
 *  - Idempotência de campanha (idempotent:campanha:{id}:{destId})
 *  - Sequências atômicas opcionais (seq:{empresaId}:{tipo})
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private clientInstance!: Redis;

  constructor(private readonly env: EnvService) {}

  async onModuleInit(): Promise<void> {
    // buildRedisOptions detecta TLS pelo scheme da URL (rediss:// vs redis://)
    const redisUrl = this.env.get('REDIS_URL');
    this.clientInstance = new IORedis(
      redisUrl,
      buildRedisOptions(redisUrl, {
        // Necessário pra BullMQ-compat e evitar reconnect storms
        maxRetriesPerRequest: null,
      }),
    );

    this.clientInstance.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.clientInstance.on('connect', () => {
      this.logger.log('Redis conectado');
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.clientInstance) {
      await this.clientInstance.quit().catch(() => {
        /* já desconectado */
      });
    }
  }

  /** Acesso ao client raw quando precisar de comandos específicos do ioredis. */
  get client(): Redis {
    if (!this.clientInstance) {
      throw new Error('RedisService não inicializado (onModuleInit ainda não rodou)');
    }
    return this.clientInstance;
  }

  // ─── Helpers de alto nível ─────────────────────────────────────────────

  /**
   * SETNX com expiração — usado para locks (cron, idempotência).
   * Retorna true se a chave foi criada; false se já existia.
   */
  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.clientInstance.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** SET com expiração — sobrescreve valor existente. */
  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.clientInstance.set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.clientInstance.get(key);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.clientInstance.del(...keys);
  }

  /** INCR atomic — usado para sequências. Retorna o novo valor. */
  async incr(key: string): Promise<number> {
    return this.clientInstance.incr(key);
  }

  /** SET incondicional (resgate de sequência do DB no boot). */
  async set(key: string, value: string | number): Promise<void> {
    await this.clientInstance.set(key, String(value));
  }

  /**
   * EVAL — executa script Lua atomicamente no Redis.
   *
   * Útil pra compare-and-swap (CAS) e operações multi-key que precisam ser
   * indivisíveis (ex.: refresh token rotation com detecção de reuse).
   *
   * Retorna o valor retornado pelo script (string|number|null|Array).
   */
  async eval(
    script: string,
    keys: string[],
    args: Array<string | number>,
  ): Promise<unknown> {
    return this.clientInstance.eval(
      script,
      keys.length,
      ...keys,
      ...args.map(String),
    );
  }
}
