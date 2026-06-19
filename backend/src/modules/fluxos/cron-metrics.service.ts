import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@database/redis.service';

/** Chave da lista (capada) de atrasos de disparo do cron, em ms. */
const DELAYS_KEY = 'cron:metrics:delays';
/** Janela deslizante: guarda as últimas N amostras de atraso. */
const MAX_AMOSTRAS = 1000;
/** Alerta quando o p99 do atraso passa de 1 minuto (meta de latência). */
const ALERTA_P99_MS = 60_000;

export interface CronMetricas {
  amostras: number;
  mediaMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** p99 acima da meta de 1 min — pra alerta no painel Admin. */
  alerta: boolean;
}

/**
 * Métrica de latência dos crons agendados — registra o atraso entre o horário
 * agendado (cursor `cron:next:<id>`) e o disparo real, e agrega em percentis.
 *
 * Best-effort: falha de Redis NÃO derruba o disparo do cron (só perde a amostra).
 */
@Injectable()
export class CronMetricsService {
  private readonly logger = new Logger(CronMetricsService.name);

  constructor(private readonly redis: RedisService) {}

  /** Registra o atraso (ms) entre o horário agendado e o disparo real. */
  async registrar(deltaMs: number): Promise<void> {
    const v = Math.max(0, Math.round(deltaMs));
    try {
      await this.redis.lpushCapped(DELAYS_KEY, v, MAX_AMOSTRAS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao registrar delta do cron: ${msg}`);
    }
  }

  /** Agrega as últimas amostras de atraso em média + percentis. */
  async obterMetricas(): Promise<CronMetricas> {
    let valores: number[] = [];
    try {
      const raw = await this.redis.lrange(DELAYS_KEY);
      valores = raw.map((s) => Number(s)).filter((n) => Number.isFinite(n));
    } catch {
      valores = [];
    }
    if (valores.length === 0) {
      return { amostras: 0, mediaMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, alerta: false };
    }
    const ord = [...valores].sort((a, b) => a - b);
    const soma = ord.reduce((acc, n) => acc + n, 0);
    const p99 = percentil(ord, 99);
    return {
      amostras: ord.length,
      mediaMs: Math.round(soma / ord.length),
      p50Ms: percentil(ord, 50),
      p95Ms: percentil(ord, 95),
      p99Ms: p99,
      maxMs: ord[ord.length - 1],
      alerta: p99 > ALERTA_P99_MS,
    };
  }
}

/** Percentil (nearest-rank) de um array JÁ ORDENADO ascendente. */
function percentil(ordenado: number[], p: number): number {
  if (ordenado.length === 0) return 0;
  const rank = Math.ceil((p / 100) * ordenado.length);
  const idx = Math.min(ordenado.length - 1, Math.max(0, rank - 1));
  return ordenado[idx];
}
