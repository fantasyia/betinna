import { describe, expect, it } from 'vitest';
import { codificarProximo, delayRestanteMs, lerProximo } from './proximo-claim.util';

/**
 * Auditoria 13/09/2026 (D-1): o claim guardava só o id do sucessor; skip
 * idempotente e reaper reenfileiravam o sucessor de um DELAY com delay ZERO.
 */
describe('proximo-claim.util', () => {
  it('id puro (linha antiga) lê sem alvo → delay 0', () => {
    expect(lerProximo('no-3')).toEqual({ noId: 'no-3', alvoEm: null });
    expect(delayRestanteMs(null)).toBe(0);
  });

  it('codifica e lê o alvo, e o delay restante é o que falta (nunca negativo)', () => {
    const alvo = 1_800_000_000_000;
    const bruto = codificarProximo('no-3', alvo);
    expect(bruto).toBe('no-3@1800000000000');
    expect(lerProximo(bruto)).toEqual({ noId: 'no-3', alvoEm: alvo });
    expect(delayRestanteMs(alvo, alvo - 5_000)).toBe(5_000);
    expect(delayRestanteMs(alvo, alvo + 5_000)).toBe(0);
  });

  it('alvo inválido cai pra "sem alvo" em vez de quebrar o id', () => {
    expect(lerProximo('no-3@abc')).toEqual({ noId: 'no-3@abc', alvoEm: null });
    expect(codificarProximo('no-3', null)).toBe('no-3');
  });
});
