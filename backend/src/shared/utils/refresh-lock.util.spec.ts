import { describe, expect, it, vi } from 'vitest';
import { comLockDeRefresh } from './refresh-lock.util';

/**
 * O bug que isto trava (#40): ML/Shopee/TikTok ROTACIONAM o refresh_token a cada
 * troca. Duas chamadas concorrentes com o token vencido usavam o MESMO refresh —
 * a segunda tomava invalid_grant e podia persistir por cima um token já morto.
 * A integração quebrava até alguém reconectar na mão.
 */
const redisOk = () => ({
  setNxEx: vi.fn().mockResolvedValue(true),
  del: vi.fn().mockResolvedValue(1),
});

describe('comLockDeRefresh', () => {
  it('quem pega o lock renova e LIBERA a chave no fim', async () => {
    const redis = redisOk();
    const renovar = vi.fn().mockResolvedValue({ token: 'novo' });

    const r = await comLockDeRefresh(redis as never, 'k', {
      reler: vi.fn(),
      valida: () => true,
      renovar,
    });

    expect(r).toEqual({ token: 'novo' });
    expect(renovar).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('k');
  });

  it('libera o lock mesmo se o refresh FALHAR (senão trava todo mundo até o TTL)', async () => {
    const redis = redisOk();
    const renovar = vi.fn().mockRejectedValue(new Error('invalid_grant'));

    await expect(
      comLockDeRefresh(redis as never, 'k', { reler: vi.fn(), valida: () => true, renovar }),
    ).rejects.toThrow('invalid_grant');
    expect(redis.del).toHaveBeenCalledWith('k');
  });

  it('quem PERDE o lock não renova — espera e relê a credencial do vencedor', async () => {
    const redis = { setNxEx: vi.fn().mockResolvedValue(false), del: vi.fn() };
    const renovar = vi.fn();
    const reler = vi.fn().mockResolvedValue({ token: 'do-vencedor' });

    const r = await comLockDeRefresh(
      redis as never,
      'k',
      { reler, valida: () => true, renovar },
      { esperaMs: 1 },
    );

    expect(r).toEqual({ token: 'do-vencedor' });
    expect(renovar).not.toHaveBeenCalled(); // ← o ponto do achado
  });

  it('se o vencedor travar, o perdedor tenta assim mesmo (não deixa sem token)', async () => {
    const redis = { setNxEx: vi.fn().mockResolvedValue(false), del: vi.fn() };
    const renovar = vi.fn().mockResolvedValue({ token: 'fallback' });

    const r = await comLockDeRefresh(
      redis as never,
      'k',
      { reler: vi.fn().mockResolvedValue(null), valida: () => true, renovar },
      { esperaMs: 1, tentativas: 2 },
    );

    expect(r).toEqual({ token: 'fallback' });
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it('credencial relida INVÁLIDA não conta como sucesso', async () => {
    const redis = { setNxEx: vi.fn().mockResolvedValue(false), del: vi.fn() };
    const renovar = vi.fn().mockResolvedValue({ token: 'fallback' });

    await comLockDeRefresh(
      redis as never,
      'k',
      { reler: vi.fn().mockResolvedValue({ token: 'vencido' }), valida: () => false, renovar },
      { esperaMs: 1, tentativas: 2 },
    );

    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it('Redis fora: degrada pra SEM lock, mas o refresh acontece', async () => {
    const redis = {
      setNxEx: vi.fn().mockRejectedValue(new Error('redis down')),
      del: vi.fn().mockRejectedValue(new Error('redis down')),
    };
    const renovar = vi.fn().mockResolvedValue({ token: 'novo' });

    const r = await comLockDeRefresh(redis as never, 'k', {
      reler: vi.fn(),
      valida: () => true,
      renovar,
    });

    expect(r).toEqual({ token: 'novo' });
  });
});
