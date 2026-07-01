import { describe, it, expect } from 'vitest';
import { matchFiltroPayload, valorPorCaminho } from './match-payload-filtro.util';

describe('valorPorCaminho', () => {
  it('anda no caminho aninhado', () => {
    expect(valorPorCaminho({ data: { status: 'pago' } }, 'data.status')).toBe('pago');
  });
  it('caminho inexistente → undefined', () => {
    expect(valorPorCaminho({ a: 1 }, 'b.c')).toBeUndefined();
  });
  it('cap de profundidade: não alcança leaf além de 8 níveis', () => {
    // leaf 'x' no fundo de 9 níveis; o cap de 8 impede alcançá-lo.
    let obj: Record<string, unknown> = { fim: 'x' };
    for (let i = 0; i < 9; i++) obj = { n: obj };
    const caminho = Array(9).fill('n').join('.') + '.fim';
    expect(valorPorCaminho(obj, caminho)).not.toBe('x');
  });
});

describe('matchFiltroPayload', () => {
  it('sem caminho → não filtra (true)', () => {
    expect(matchFiltroPayload({ x: 1 }, undefined)).toBe(true);
    expect(matchFiltroPayload({ x: 1 }, { caminho: '', operador: 'eq', valor: 'y' })).toBe(true);
  });
  it('eq', () => {
    expect(
      matchFiltroPayload(
        { evento: 'lead_gerado' },
        { caminho: 'evento', operador: 'eq', valor: 'lead_gerado' },
      ),
    ).toBe(true);
    expect(
      matchFiltroPayload(
        { evento: 'outro' },
        { caminho: 'evento', operador: 'eq', valor: 'lead_gerado' },
      ),
    ).toBe(false);
  });
  it('neq', () => {
    expect(
      matchFiltroPayload({ evento: 'x' }, { caminho: 'evento', operador: 'neq', valor: 'y' }),
    ).toBe(true);
  });
  it('contains', () => {
    expect(
      matchFiltroPayload(
        { msg: 'pedido 123 pago' },
        { caminho: 'msg', operador: 'contains', valor: 'pago' },
      ),
    ).toBe(true);
  });
  it('coage número/boolean pra string', () => {
    expect(
      matchFiltroPayload({ total: 100 }, { caminho: 'total', operador: 'eq', valor: '100' }),
    ).toBe(true);
    expect(matchFiltroPayload({ ok: true }, { caminho: 'ok', operador: 'eq', valor: 'true' })).toBe(
      true,
    );
  });
});
