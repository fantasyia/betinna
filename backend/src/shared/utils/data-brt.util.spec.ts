import { describe, expect, it } from 'vitest';
import { vigenteAteFimDoDiaBrt } from './data-brt.util';

describe('vigenteAteFimDoDiaBrt', () => {
  // validoAte é date-only: meia-noite UTC do dia impresso.
  const validoAte = new Date('2026-07-15T00:00:00.000Z');

  it('null/undefined = sem prazo → sempre vigente', () => {
    expect(vigenteAteFimDoDiaBrt(null, new Date('2030-01-01T00:00:00Z'))).toBe(true);
    expect(vigenteAteFimDoDiaBrt(undefined, new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('21h BRT do próprio dia 15 (00:00 UTC do dia 16) ainda é vigente — o bug #R2', () => {
    // 15/07 21:00 BRT = 16/07 00:00 UTC. Com comparação crua vencia; agora NÃO.
    expect(vigenteAteFimDoDiaBrt(validoAte, new Date('2026-07-16T00:00:00.000Z'))).toBe(true);
  });

  it('23:59:59.999 BRT do dia 15 (02:59:59.999 UTC do dia 16) = último instante vigente', () => {
    expect(vigenteAteFimDoDiaBrt(validoAte, new Date('2026-07-16T02:59:59.999Z'))).toBe(true);
  });

  it('00:00 BRT do dia 16 (03:00 UTC do dia 16) já venceu', () => {
    expect(vigenteAteFimDoDiaBrt(validoAte, new Date('2026-07-16T03:00:00.000Z'))).toBe(false);
  });

  it('meio-dia BRT do próprio dia 15 é vigente', () => {
    expect(vigenteAteFimDoDiaBrt(validoAte, new Date('2026-07-15T15:00:00.000Z'))).toBe(true);
  });
});
