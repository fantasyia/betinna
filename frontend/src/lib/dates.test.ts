import { describe, it, expect } from 'vitest';
import { inicioDoDiaLocalISO, fimDoDiaLocalISO } from './dates';

// TZ-independente: valida via getHours/getDate LOCAL do Date reconstruído (não pelo texto ISO,
// que varia com o fuso da máquina). O que importa é que o instante representa 00:00 / 23:59 LOCAL
// do dia informado — não a meia-noite UTC (bug #14).

describe('dates — parse local de YYYY-MM-DD (#14)', () => {
  it('inicioDoDiaLocalISO ancora em 00:00 LOCAL do dia informado', () => {
    const d = new Date(inicioDoDiaLocalISO('2026-07-07'));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // julho (0-indexed)
    expect(d.getDate()).toBe(7); // dia 7, não 6
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('fimDoDiaLocalISO ancora em 23:59:59.999 LOCAL do mesmo dia', () => {
    const d = new Date(fimDoDiaLocalISO('2026-07-07'));
    expect(d.getDate()).toBe(7); // ainda dia 7 (não vaza pro 8)
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
  });

  it('início < fim do mesmo dia (janela cobre o dia inteiro)', () => {
    const ini = new Date(inicioDoDiaLocalISO('2026-07-07')).getTime();
    const fim = new Date(fimDoDiaLocalISO('2026-07-07')).getTime();
    expect(fim - ini).toBeGreaterThan(23 * 3600 * 1000); // ~24h de janela
  });

  it('retorna ISO UTC válido (Z no fim)', () => {
    expect(inicioDoDiaLocalISO('2026-01-15')).toMatch(/Z$/);
    expect(fimDoDiaLocalISO('2026-01-15')).toMatch(/Z$/);
  });
});
