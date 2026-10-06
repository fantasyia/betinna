import { describe, expect, it } from 'vitest';
import { hojeIso, rotuloSituacao } from './tipos';

describe('financeiro — tela', () => {
  it('"hoje" é o dia de Brasília', () => {
    expect(hojeIso(new Date('2026-10-08T02:30:00Z'))).toBe('2026-10-07');
  });
  it('rótulo muda pelo lado (receber × pagar)', () => {
    expect(rotuloSituacao('QUITADO', 'RECEBER').texto).toBe('Recebido');
    expect(rotuloSituacao('QUITADO', 'PAGAR').texto).toBe('Pago');
    expect(rotuloSituacao('VENCIDO', 'PAGAR')).toEqual({ texto: 'Vencido', tom: 'danger' });
  });
});
