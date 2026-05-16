import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@database/redis.service';

/**
 * Lock distribuído para crons.
 *
 * Em ambiente multi-replica (Railway rolling deploy, escala manual), todos os
 * containers rodam o mesmo cron. Sem lock, jobs duplicam (comissão paga 2x,
 * campanha disparada 2x).
 *
 * Estratégia: `SET key NX EX <ttl>` — se uma réplica adquiriu o lock, as outras
 * fazem early-return. TTL deve ser MENOR que o intervalo do cron — assim na
 * próxima execução o lock já expirou.
 *
 * Uso:
 *   @Cron('* / 5 * * * *')
 *   async meuJob() {
 *     const acquired = await this.cronLock.acquire('meu-job', 270);
 *     if (!acquired) return;
 *     // ... lógica
 *   }
 */
@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);
  private readonly instanceId = process.env.INSTANCE_ID ?? `host-${process.pid}`;

  constructor(private readonly redis: RedisService) {}

  /**
   * Tenta adquirir o lock. Retorna true se conseguiu (esta réplica deve rodar)
   * ou false se outra réplica já está rodando.
   *
   * @param name  Nome único do cron (ex: 'comissoes-fechamento')
   * @param ttlSeconds  TTL do lock em segundos (use intervalo cron - margem)
   */
  async acquire(name: string, ttlSeconds: number): Promise<boolean> {
    const key = `cron:lock:${name}`;
    try {
      const acquired = await this.redis.setNxEx(key, this.instanceId, ttlSeconds);
      if (acquired) {
        this.logger.debug(`Lock adquirido por ${this.instanceId}: ${name}`);
      } else {
        this.logger.debug(`Lock ${name} já está em uso — esta réplica pula`);
      }
      return acquired;
    } catch (err) {
      // Se Redis está fora, melhor deixar rodar (singleton degraded) do que parar
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`CronLock falha em ${name}: ${msg} — executando sem lock`);
      return true;
    }
  }

  /** Libera o lock manualmente (opcional — TTL já cuida). */
  async release(name: string): Promise<void> {
    await this.redis.del(`cron:lock:${name}`).catch(() => {
      /* ignora — TTL eventualmente limpa */
    });
  }
}
