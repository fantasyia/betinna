import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CronLockService } from './cron-lock.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRedisMock = () => ({
  setNxEx: vi.fn(),
  del: vi.fn().mockResolvedValue(1),
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CronLockService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let service: CronLockService;

  beforeEach(() => {
    redis = makeRedisMock();
    service = new CronLockService(redis as never);
  });

  // -------------------------------------------------------------------------
  // acquire
  // -------------------------------------------------------------------------

  describe('acquire', () => {
    it('retorna true quando lock é adquirido (chave não existia)', async () => {
      redis.setNxEx.mockResolvedValue(true);

      const result = await service.acquire('meu-cron', 270);

      expect(result).toBe(true);
    });

    it('retorna false quando lock já existe (outra réplica está rodando)', async () => {
      redis.setNxEx.mockResolvedValue(false);

      const result = await service.acquire('meu-cron', 270);

      expect(result).toBe(false);
    });

    it('chama setNxEx com chave formatada como cron:lock:{name}', async () => {
      redis.setNxEx.mockResolvedValue(true);

      await service.acquire('comissoes-fechamento', 270);

      expect(redis.setNxEx).toHaveBeenCalledWith(
        'cron:lock:comissoes-fechamento',
        expect.any(String),
        270,
      );
    });

    it('retorna true quando Redis falha (degraded mode — executa sem lock)', async () => {
      redis.setNxEx.mockRejectedValue(new Error('Redis connection refused'));

      const result = await service.acquire('fallback-cron', 60);

      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // release
  // -------------------------------------------------------------------------

  describe('release', () => {
    it('remove chave do Redis no formato cron:lock:{name}', async () => {
      await service.release('meu-cron');

      expect(redis.del).toHaveBeenCalledWith('cron:lock:meu-cron');
    });

    it('não lança quando del falha (TTL cuida da limpeza)', async () => {
      redis.del.mockRejectedValue(new Error('Redis error'));

      await expect(service.release('meu-cron')).resolves.toBeUndefined();
    });
  });
});
