import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { EnvService } from '@config/env.service';
import { createIORedisClient } from './redis-options';

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
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private clientInstance!: Redis;
  // Hotpatch 2026-05-20: log throttle pra evitar spam quando Redis está down.
  // Uma mensagem a cada 30s em vez de uma por reconnect attempt.
  private lastErrorLog = 0;

  constructor(private readonly env: EnvService) {}

  async onModuleInit(): Promise<void> {
    // createIORedisClient já attacha handler 'error' (evita unhandled event).
    // Aqui passamos onError customizado pra deduplicar log spam.
    const redisUrl = this.env.get('REDIS_URL');
    this.clientInstance = createIORedisClient(redisUrl, { maxRetriesPerRequest: null }, (err) => {
      const now = Date.now();
      if (now - this.lastErrorLog > 30_000) {
        this.logger.warn(`Redis error: ${err.message} (suprimindo logs duplicados por 30s)`);
        this.lastErrorLog = now;
      }
    });
    this.clientInstance.on('connect', () => {
      this.lastErrorLog = 0; // reset throttle quando volta
      this.logger.log('Redis conectado');
    });
  }

  /**
   * Fase 3 do shutdown, NÃO a 1 (`onModuleDestroy`). O `@nestjs/bullmq` só drena
   * os workers em `onApplicationShutdown`; fechar aqui na fase 1 deixava o job de
   * IA rodando com a conexão já morta — "Connection is closed." no meio do envio,
   * passo FALHOU, re-execução no worker novo e o cliente recebendo a mensagem em
   * dobro (medido em 05/09). Na mesma fase, este módulo (raiz) fecha por último.
   */
  async onApplicationShutdown(): Promise<void> {
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
   * LPUSH + LTRIM atômico — mantém uma lista capada nos últimos `maxLen` itens
   * (janela deslizante). Usado para amostras de métrica (ex: atraso do cron).
   */
  async lpushCapped(key: string, value: string | number, maxLen: number): Promise<void> {
    const pipe = this.clientInstance.multi();
    pipe.lpush(key, String(value));
    pipe.ltrim(key, 0, maxLen - 1);
    await pipe.exec();
  }

  /**
   * RPOP em lote — tira do FIM da lista, que com `lpushCapped` é o item MAIS
   * ANTIGO. Ordem de chegada importa em fila de evento: aplicar a atualização
   * nova antes da velha faria o estado final ser o errado.
   */
  async rpop(key: string, quantidade: number): Promise<string[]> {
    if (quantidade <= 0) return [];
    const r = await this.clientInstance.rpop(key, quantidade);
    return r ?? [];
  }

  /** LRANGE 0 -1 — retorna a lista inteira como strings. */
  async lrange(key: string): Promise<string[]> {
    return this.clientInstance.lrange(key, 0, -1);
  }

  /**
   * EVAL — executa script Lua atomicamente no Redis.
   *
   * Útil pra compare-and-swap (CAS) e operações multi-key que precisam ser
   * indivisíveis (ex.: refresh token rotation com detecção de reuse).
   *
   * Retorna o valor retornado pelo script (string|number|null|Array).
   */
  async eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    return this.clientInstance.eval(script, keys.length, ...keys, ...args.map(String));
  }
}
