import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { WebhookAntiReplayService } from './webhook-anti-replay.service';

describe('WebhookAntiReplayService', () => {
  let redis: { setNxEx: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let svc: WebhookAntiReplayService;

  beforeEach(() => {
    redis = {
      setNxEx: vi.fn().mockResolvedValue(true),
      get: vi.fn(),
    };
    svc = new WebhookAntiReplayService(redis as never);
  });

  describe('timestamp window', () => {
    it('aceita timestamp dentro da janela de 5min', async () => {
      const now = Math.floor(Date.now() / 1000); // segundos
      const r = await svc.checkAndMarkWebhook('shopee', 'sig-abc', now);
      expect(r.fresh).toBe(true);
    });

    it('aceita timestamp em milissegundos (auto-detecta)', async () => {
      const r = await svc.checkAndMarkWebhook('shopee', 'sig-abc', Date.now());
      expect(r.fresh).toBe(true);
    });

    it('aceita timestamp ISO 8601', async () => {
      const iso = new Date().toISOString();
      const r = await svc.checkAndMarkWebhook('meta', 'sig-abc', iso);
      expect(r.fresh).toBe(true);
    });

    it('rejeita timestamp 6min atrás (replay attack)', async () => {
      const seisMinAtras = Math.floor((Date.now() - 6 * 60 * 1000) / 1000);
      await expect(
        svc.checkAndMarkWebhook('shopee', 'sig-abc', seisMinAtras),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // setNxEx NÃO deve ter sido chamado (rejeitou antes)
      expect(redis.setNxEx).not.toHaveBeenCalled();
    });

    it('rejeita timestamp futuro >5min (clock skew abuse)', async () => {
      const futuroLonge = Math.floor((Date.now() + 6 * 60 * 1000) / 1000);
      await expect(
        svc.checkAndMarkWebhook('shopee', 'sig-abc', futuroLonge),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita timestamp em formato inválido', async () => {
      await expect(
        svc.checkAndMarkWebhook('shopee', 'sig-abc', 'not-a-timestamp'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('aceita quando timestamp é undefined (provedor sem ts)', async () => {
      const r = await svc.checkAndMarkWebhook('mercadolivre', 'sig-abc', undefined);
      expect(r.fresh).toBe(true);
    });
  });

  describe('signature dedup (replay protection)', () => {
    it('primeira vez retorna fresh=true', async () => {
      redis.setNxEx.mockResolvedValueOnce(true);
      const r = await svc.checkAndMarkWebhook('meta', 'sig-xyz', undefined);
      expect(r.fresh).toBe(true);
      expect(redis.setNxEx).toHaveBeenCalledOnce();
    });

    it('segunda vez (replay) retorna fresh=false', async () => {
      redis.setNxEx.mockResolvedValueOnce(false);
      const r = await svc.checkAndMarkWebhook('meta', 'sig-xyz', undefined);
      expect(r.fresh).toBe(false);
    });

    it('hash da signature é estável (mesma signature → mesma key)', async () => {
      const r1 = await svc.checkAndMarkWebhook('meta', 'sig-abc', undefined);
      redis.setNxEx.mockClear();
      const r2 = await svc.checkAndMarkWebhook('meta', 'sig-abc', undefined);
      expect(r1.signatureHash).toBe(r2.signatureHash);
      // A 2ª chamada usa a mesma key
      const key2 = redis.setNxEx.mock.calls[0][0];
      expect(key2).toContain(r1.signatureHash);
    });

    it('signatures diferentes geram keys diferentes', async () => {
      const r1 = await svc.checkAndMarkWebhook('meta', 'sig-a', undefined);
      const r2 = await svc.checkAndMarkWebhook('meta', 'sig-b', undefined);
      expect(r1.signatureHash).not.toBe(r2.signatureHash);
    });

    it('mesmo signature em providers diferentes = não-replay (isolado)', async () => {
      redis.setNxEx.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      const r1 = await svc.checkAndMarkWebhook('meta', 'sig-abc', undefined);
      const r2 = await svc.checkAndMarkWebhook('shopee', 'sig-abc', undefined);
      expect(r1.fresh).toBe(true);
      expect(r2.fresh).toBe(true);
      const keys = redis.setNxEx.mock.calls.map((c) => c[0]);
      expect(keys[0]).toContain('meta');
      expect(keys[1]).toContain('shopee');
    });
  });

  describe('Redis offline (degraded mode)', () => {
    it('quando Redis falha em SETNX, aceita com warn (fail-open)', async () => {
      redis.setNxEx.mockRejectedValueOnce(new Error('Redis connection lost'));
      const r = await svc.checkAndMarkWebhook('meta', 'sig-abc', undefined);
      // Em degraded mode, prossegue (não bloqueia operação por infra)
      expect(r.fresh).toBe(true);
    });
  });
});
