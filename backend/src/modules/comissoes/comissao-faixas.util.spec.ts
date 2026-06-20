import { describe, expect, it } from 'vitest';
import { faixaPercentual, resolveComissaoBonus } from './comissao-faixas.util';

describe('resolveComissaoBonus', () => {
  it('sem config → modelo fixa, faixas vazias', () => {
    expect(resolveComissaoBonus(undefined)).toEqual({ modelo: 'fixa', faixas: [] });
  });

  it('saneia faixas inválidas e normaliza ate ausente como null (aberto)', () => {
    const c = resolveComissaoBonus({
      modelo: 'escalonada_por_faturamento',
      faixas: [
        { de: 0, ate: 10000, percentual: 3 },
        { de: 10000, percentual: 5 }, // ate ausente → aberto
        { de: 'x', percentual: 9 }, // inválida → removida
      ],
    });
    expect(c.modelo).toBe('escalonada_por_faturamento');
    expect(c.faixas).toEqual([
      { de: 0, ate: 10000, percentual: 3 },
      { de: 10000, ate: null, percentual: 5 },
    ]);
  });

  it('modelo desconhecido → fixa', () => {
    expect(resolveComissaoBonus({ modelo: 'qualquer' }).modelo).toBe('fixa');
  });
});

describe('faixaPercentual', () => {
  const faixas = [
    { de: 0, ate: 10000, percentual: 3 },
    { de: 10000.01, ate: 50000, percentual: 5 },
    { de: 50000.01, ate: null, percentual: 7 },
  ];

  it('pega a faixa certa por intervalo', () => {
    expect(faixaPercentual(faixas, 5000)).toBe(3);
    expect(faixaPercentual(faixas, 30000)).toBe(5);
    expect(faixaPercentual(faixas, 999999)).toBe(7); // faixa aberta
  });

  it('limites inclusivos', () => {
    expect(faixaPercentual(faixas, 10000)).toBe(3);
    expect(faixaPercentual(faixas, 50000)).toBe(5);
  });

  it('ordena por de antes de casar', () => {
    const fora = [
      { de: 50000.01, ate: null, percentual: 7 },
      { de: 0, ate: 10000, percentual: 3 },
    ];
    expect(faixaPercentual(fora, 5000)).toBe(3);
  });

  it('sem faixa que case → 0', () => {
    expect(faixaPercentual([], 5000)).toBe(0);
  });
});
