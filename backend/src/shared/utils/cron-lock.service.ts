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
  async acquire(
    name: string,
    ttlSeconds: number,
    opts?: { failClosedOnError?: boolean },
  ): Promise<boolean> {
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
      const msg = err instanceof Error ? err.message : String(err);
      // Jobs com efeito monetário/destrutivo (comissão, purga LGPD) preferem NÃO rodar a
      // arriscar duplicar sem lock → fail-CLOSED. Jobs leves/idempotentes seguem degradados.
      if (opts?.failClosedOnError) {
        this.logger.error(
          `CronLock falha em ${name}: ${msg} — fail-CLOSED (job crítico não roda).`,
        );
        return false;
      }
      this.logger.warn(`CronLock falha em ${name}: ${msg} — executando sem lock (degradado).`);
      return true;
    }
  }

  /**
   * Libera o lock — só se ESTA réplica é a dona (fencing via Lua compare-and-delete). Sem isso,
   * uma réplica lenta podia apagar o lock que outra já readquiriu, abrindo execução em dobro.
   */
  async release(name: string): Promise<void> {
    await this.redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        [`cron:lock:${name}`],
        [this.instanceId],
      )
      .catch(() => {
        /* ignora — TTL eventualmente limpa */
      });
  }
}
