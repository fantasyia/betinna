import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CronLockService } from './cron-lock.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRedisMock = () => ({
  setNxEx: vi.fn(),
  // release() agora é compare-and-delete via eval (Lua), não del direto.
  eval: vi.fn().mockResolvedValue(1),
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
    it('faz compare-and-delete (eval) na chave cron:lock:{name}', async () => {
      await service.release('meu-cron');

      // Lua compare-and-delete: script com del, KEYS=[chave], ARGV=[instanceId].
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        ['cron:lock:meu-cron'],
        expect.any(Array),
      );
    });

    it('não lança quando o eval falha (TTL cuida da limpeza)', async () => {
      redis.eval.mockRejectedValue(new Error('Redis error'));

      await expect(service.release('meu-cron')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Atomicidade — concorrência simulada com store real
  // -------------------------------------------------------------------------

  describe('atomicidade (multi-replica)', () => {
    /**
     * Re-instancia o service com um Redis "real" (em memória, mas com
     * semântica atômica de SETNX). Cobre cenário multi-worker.
     */
    function makeAtomicRedis() {
      const store = new Map<string, { value: string; expiresAt: number }>();
      return {
        store,
        setNxEx: vi.fn(async (key: string, value: string, ttl: number) => {
          const now = Date.now();
          const existing = store.get(key);
          if (existing && existing.expiresAt > now) return false;
          store.set(key, { value, expiresAt: now + ttl * 1000 });
          return true;
        }),
        // eval = compare-and-delete (fencing): só apaga se o value bate com ARGV[0] (instanceId).
        eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
          const e = store.get(keys[0]);
          if (e && e.value === args[0]) {
            store.delete(keys[0]);
            return 1;
          }
          return 0;
        }),
      };
    }

    it('10 réplicas paralelas: só 1 vence o lock', async () => {
      const atomicRedis = makeAtomicRedis();
      const svc = new CronLockService(atomicRedis as never);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => svc.acquire('parallel', 60)),
      );
      const vencedores = results.filter((r) => r === true);
      const perdedores = results.filter((r) => r === false);
      expect(vencedores).toHaveLength(1);
      expect(perdedores).toHaveLength(9);
    });

    it('após TTL expirar, outra réplica adquire', async () => {
      const atomicRedis = makeAtomicRedis();
      const svc = new CronLockService(atomicRedis as never);

      await svc.acquire('ttl-test', 60);
      // Simula expiração forçando expiresAt no passado
      const entry = atomicRedis.store.get('cron:lock:ttl-test');
      if (entry) entry.expiresAt = Date.now() - 1000;

      const r = await svc.acquire('ttl-test', 60);
      expect(r).toBe(true);
    });

    it('locks de crons diferentes não conflitam', async () => {
      const atomicRedis = makeAtomicRedis();
      const svc = new CronLockService(atomicRedis as never);
      const a = await svc.acquire('cron-A', 60);
      const b = await svc.acquire('cron-B', 60);
      expect(a).toBe(true);
      expect(b).toBe(true);
    });

    it('release seguido de acquire funciona normal', async () => {
      const atomicRedis = makeAtomicRedis();
      const svc = new CronLockService(atomicRedis as never);
      await svc.acquire('reacquire', 60);
      await svc.release('reacquire');
      const r = await svc.acquire('reacquire', 60);
      expect(r).toBe(true);
    });
  });
});
