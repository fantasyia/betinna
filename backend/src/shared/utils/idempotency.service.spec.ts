import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IdempotencyService } from './idempotency.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRedisMock = () => ({
  setNxEx: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('IdempotencyService', () => {
  let redis: ReturnType<typeof makeRedisMock>;
  let service: IdempotencyService;

  beforeEach(() => {
    redis = makeRedisMock();
    service = new IdempotencyService(redis as never);
  });

  // -------------------------------------------------------------------------
  // claim
  // -------------------------------------------------------------------------

  describe('claim', () => {
    it('retorna true quando claim é bem-sucedido (chave não existia)', async () => {
      redis.setNxEx.mockResolvedValue(true);

      const result = await service.claim('key-1', 3600);

      expect(result).toBe(true);
      expect(redis.setNxEx).toHaveBeenCalledWith('key-1', '1', 3600);
    });

    it('retorna false quando chave já existe (operação já processada)', async () => {
      redis.setNxEx.mockResolvedValue(false);

      const result = await service.claim('key-1');

      expect(result).toBe(false);
    });

    it('usa TTL padrão de 86400s quando não especificado', async () => {
      redis.setNxEx.mockResolvedValue(true);

      await service.claim('my-key');

      expect(redis.setNxEx).toHaveBeenCalledWith('my-key', '1', 86_400);
    });

    it('retorna false quando Redis falha (bail — evita duplicar side-effect)', async () => {
      redis.setNxEx.mockRejectedValue(new Error('Redis connection refused'));

      const result = await service.claim('key-1');

      expect(result).toBe(false); // bail conservador
    });
  });

  // -------------------------------------------------------------------------
  // exists
  // -------------------------------------------------------------------------

  describe('exists', () => {
    it('retorna true quando chave existe no Redis', async () => {
      redis.get.mockResolvedValue('1');

      const result = await service.exists('key-1');

      expect(result).toBe(true);
    });

    it('retorna false quando chave não existe', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.exists('key-1');

      expect(result).toBe(false);
    });

    it('retorna false quando Redis falha (catch → null)', async () => {
      redis.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.exists('key-1');

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // release
  // -------------------------------------------------------------------------

  describe('release', () => {
    it('remove a chave do Redis', async () => {
      redis.del.mockResolvedValue(1);

      await expect(service.release('key-1')).resolves.toBeUndefined();

      expect(redis.del).toHaveBeenCalledWith('key-1');
    });

    it('não lança quando del falha (ignora erro)', async () => {
      redis.del.mockRejectedValue(new Error('Redis connection refused'));

      await expect(service.release('key-1')).resolves.toBeUndefined();
    });
  });
});
