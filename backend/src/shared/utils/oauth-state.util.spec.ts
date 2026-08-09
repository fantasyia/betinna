import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { deriveOAuthStateSecret, signOAuthState, verifyOAuthState } from './oauth-state.util';

const KEY = 'a'.repeat(64);
const secret = deriveOAuthStateSecret(KEY, 'teste-oauth-state');

describe('oauth-state.util — anti-replay do nonce (#B17)', () => {
  it('sem consumidor de nonce: segue aceitando (comportamento antigo preservado)', async () => {
    const state = await signOAuthState(secret, { eid: 'emp-1' });
    expect(await verifyOAuthState(secret, state, 'eid')).toBe('emp-1');
    // e de novo, porque ninguém queima o jti
    expect(await verifyOAuthState(secret, state, 'eid')).toBe('emp-1');
  });

  it('1º uso passa e QUEIMA o jti; o 2º é recusado como replay', async () => {
    const usados = new Set<string>();
    const consumir = vi.fn(async (jti: string) => {
      if (usados.has(jti)) return false;
      usados.add(jti);
      return true;
    });
    const state = await signOAuthState(secret, { eid: 'emp-1' });

    expect(await verifyOAuthState(secret, state, 'eid', consumir)).toBe('emp-1');
    await expect(verifyOAuthState(secret, state, 'eid', consumir)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(consumir).toHaveBeenCalledTimes(2);
  });

  it('o TTL passado ao consumidor cobre o resto da validade do state', async () => {
    const consumir = vi.fn().mockResolvedValue(true);
    const state = await signOAuthState(secret, { eid: 'emp-1' }, 5);

    await verifyOAuthState(secret, state, 'eid', consumir);

    const [, ttl] = consumir.mock.calls[0];
    // 5min restantes + folga de 30s, com margem pro relógio do teste
    expect(ttl).toBeGreaterThan(300);
    expect(ttl).toBeLessThanOrEqual(340);
  });

  it('cada state tem jti próprio — assinar duas vezes não colide', async () => {
    const vistos: string[] = [];
    const consumir = vi.fn(async (jti: string) => {
      vistos.push(jti);
      return true;
    });
    await verifyOAuthState(secret, await signOAuthState(secret, { eid: 'e' }), 'eid', consumir);
    await verifyOAuthState(secret, await signOAuthState(secret, { eid: 'e' }), 'eid', consumir);

    expect(new Set(vistos).size).toBe(2);
  });

  it('state assinado com OUTRA chave é recusado antes de chegar no nonce', async () => {
    const consumir = vi.fn().mockResolvedValue(true);
    const outro = deriveOAuthStateSecret('b'.repeat(64), 'teste-oauth-state');
    const state = await signOAuthState(outro, { eid: 'emp-1' });

    await expect(verifyOAuthState(secret, state, 'eid', consumir)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(consumir).not.toHaveBeenCalled();
  });

  it('claim ausente é recusado', async () => {
    const state = await signOAuthState(secret, { uid: 'u-1' });
    await expect(verifyOAuthState(secret, state, 'eid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
