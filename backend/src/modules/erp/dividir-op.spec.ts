import { describe, expect, it } from 'vitest';
import { dividirOp, type ItemParaDividir } from './dividir-op';

/** Dividir a OP em 2 (Léo, 14/10): metade da grade, sobra ímpar na A. */

const it_ = (
  produtoId: string,
  cor: string,
  tamanho: string,
  planejada: number,
  linha = 'Regular',
): ItemParaDividir => ({
  produtoId,
  linha,
  cor,
  tamanho,
  planejada,
});

describe('dividirOp', () => {
  it('pela grade do risco: 2M 2G 1GG → A 1M 1G 1GG · B 1M 1G, folhas da cor nas duas', () => {
    const risco = {
      linha: 'Regular',
      composicao: [
        { tamanho: 'M', quantidade: 2 },
        { tamanho: 'G', quantidade: 2 },
        { tamanho: 'GG', quantidade: 1 },
      ],
      cores: [{ cor: 'Preto', grades: 20 }],
    };
    const d = dividirOp(
      [it_('pm', 'Preto', 'M', 40), it_('pg', 'Preto', 'G', 40), it_('pgg', 'Preto', 'GG', 20)],
      risco,
    );
    expect(Object.fromEntries(d.a)).toEqual({ pm: 20, pg: 20, pgg: 20 });
    expect(Object.fromEntries(d.b)).toEqual({ pm: 20, pg: 20, pgg: 0 });
    expect(d.riscoA?.composicao).toEqual([
      { tamanho: 'M', quantidade: 1 },
      { tamanho: 'G', quantidade: 1 },
      { tamanho: 'GG', quantidade: 1 },
    ]);
    expect(d.riscoB?.composicao).toEqual([
      { tamanho: 'M', quantidade: 1 },
      { tamanho: 'G', quantidade: 1 },
    ]);
    expect(d.riscoB?.cores).toEqual([{ cor: 'Preto', grades: 20 }]);
  });

  it('sem grade do risco: variação por variação, sobra ímpar na A', () => {
    const d = dividirOp([it_('p1', 'Preto', 'P', 11), it_('p2', 'Bege', 'M', 1)], null);
    expect(Object.fromEntries(d.a)).toEqual({ p1: 6, p2: 1 });
    expect(Object.fromEntries(d.b)).toEqual({ p1: 5, p2: 0 });
    expect(d.riscoA).toBeNull();
  });

  it('a soma das duas metades é a OP inteira (pela grade)', () => {
    const risco = {
      linha: 'Regular',
      composicao: [{ tamanho: 'P', quantidade: 3 }],
      cores: [{ cor: 'Preto', grades: 7 }],
    };
    const d = dividirOp([it_('pp', 'Preto', 'P', 21)], risco);
    expect(d.a.get('pp')! + d.b.get('pp')!).toBe(21);
  });
});
