import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronMetricsService } from './cron-metrics.service';
import type { RedisService } from '@database/redis.service';

/**
 * Testa a agregação de percentis do CronMetricsService — alimentada por uma
 * lista capada no Redis (mockada aqui). Cobre: vazio, registro best-effort,
 * percentis nearest-rank e o flag de alerta (p99 > 1min).
 */
function makeRedisMock(valores: number[]) {
  return {
    lrange: vi.fn().mockResolvedValue(valores.map(String)),
    lpushCapped: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisService & {
    lrange: ReturnType<typeof vi.fn>;
    lpushCapped: ReturnType<typeof vi.fn>;
  };
}

describe('CronMetricsService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let svc: CronMetricsService;

  beforeEach(() => {
    redis = makeRedisMock([]);
    svc = new CronMetricsService(redis);
  });

  it('lista vazia → zeros, sem alerta', async () => {
    const m = await svc.obterMetricas();
    expect(m).toEqual({
      amostras: 0,
      mediaMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      alerta: false,
    });
  });

  it('registrar() faz lpushCapped com o delta arredondado (clamp em 0)', async () => {
    await svc.registrar(1234.7);
    expect(redis.lpushCapped).toHaveBeenCalledWith('cron:metrics:delays', 1235, 1000);
    await svc.registrar(-50);
    expect(redis.lpushCapped).toHaveBeenLastCalledWith('cron:metrics:delays', 0, 1000);
  });

  it('registrar() é best-effort — falha do Redis não propaga', async () => {
    redis.lpushCapped.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.registrar(100)).resolves.toBeUndefined();
  });

  it('calcula média, percentis e máximo', async () => {
    // 100 amostras: 0..99 (ms). Nearest-rank: p50=índice 49→49, p95=índice 94→94, p99=índice 98→98.
    const valores = Array.from({ length: 100 }, (_, i) => i);
    svc = new CronMetricsService(makeRedisMock(valores));
    const m = await svc.obterMetricas();
    expect(m.amostras).toBe(100);
    expect(m.mediaMs).toBe(50); // round(4950/100) = 50 (49.5)
    expect(m.p50Ms).toBe(49);
    expect(m.p95Ms).toBe(94);
    expect(m.p99Ms).toBe(98);
    expect(m.maxMs).toBe(99);
    expect(m.alerta).toBe(false); // tudo abaixo de 60s
  });

  it('alerta quando p99 > 1 min', async () => {
    // 98 pequenas + 2 enormes (100 amostras): p99 nearest-rank = índice 98 → 90s.
    const valores = [...Array.from({ length: 98 }, () => 500), 90_000, 90_000];
    svc = new CronMetricsService(makeRedisMock(valores));
    const m = await svc.obterMetricas();
    expect(m.maxMs).toBe(90_000);
    expect(m.p99Ms).toBe(90_000);
    expect(m.alerta).toBe(true);
  });

  it('1 amostra grande em 100 NÃO trip o p99 (só o máximo)', async () => {
    // 99 pequenas + 1 enorme: p99 = índice 98 → ainda 500ms. Só max pega o pico.
    const valores = [...Array.from({ length: 99 }, () => 500), 90_000];
    svc = new CronMetricsService(makeRedisMock(valores));
    const m = await svc.obterMetricas();
    expect(m.p99Ms).toBe(500);
    expect(m.maxMs).toBe(90_000);
    expect(m.alerta).toBe(false);
  });

  it('ignora valores não-numéricos na lista', async () => {
    // 'abc' no meio é descartado (Number.isFinite filtra).
    svc = new CronMetricsService(makeRedisMock([]));
    (svc as unknown as { redis: { lrange: ReturnType<typeof vi.fn> } }).redis.lrange = vi
      .fn()
      .mockResolvedValue(['10', 'abc', '30']);
    const m = await svc.obterMetricas();
    expect(m.amostras).toBe(2);
    expect(m.maxMs).toBe(30);
  });
});
