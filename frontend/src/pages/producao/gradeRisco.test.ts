import { describe, expect, it } from 'vitest';
import type { CelulaGrade } from './GradeEditor';
import {
  linhasDoModelo,
  pecasPorGrade,
  quantidadesDaGrade,
  registroDaGrade,
  textoDaGrade,
} from './gradeRisco';

/** OP pela grade do risco (Léo, 14/10). */

const cel = (produtoId: string, linha: string, tamanho: string, cor: string, ord = 0): CelulaGrade => ({
  produtoId,
  cor: { nome: cor, hex: '#000000' },
  corOrdem: cor === 'Preto' ? 0 : 1,
  linha,
  linhaOrdem: linha === 'Regular' ? 0 : 1,
  tamanho,
  tamanhoOrdem: ord,
});

const celulas: CelulaGrade[] = [
  cel('p-pre-m', 'Regular', 'M', 'Preto', 1),
  cel('p-pre-g', 'Regular', 'G', 'Preto', 2),
  cel('p-pre-gg', 'Regular', 'GG', 'Preto', 3),
  cel('p-bege-m', 'Regular', 'M', 'Bege', 1),
  cel('p-bege-g', 'Regular', 'G', 'Bege', 2),
  cel('p-bege-gg', 'Regular', 'GG', 'Bege', 3),
  cel('p-pre-g1', 'Plus Size', 'G1', 'Preto', 1),
];

describe('OP pela grade do risco', () => {
  it('2M 2G 1GG: Preto × 20 grades + Bege × 10 = peças por cor e tamanho', () => {
    const q = quantidadesDaGrade(celulas, 'Regular', { M: 2, G: 2, GG: 1 }, [
      { cor: 'Preto', grades: 20 },
      { cor: 'Bege', grades: 10 },
    ]);
    expect(q).toEqual({
      'p-pre-m': '40',
      'p-pre-g': '40',
      'p-pre-gg': '20',
      'p-bege-m': '20',
      'p-bege-g': '20',
      'p-bege-gg': '10',
    });
    expect(pecasPorGrade({ M: 2, G: 2, GG: 1 })).toBe(5);
  });

  it('só a linha escolhida (o G1 da Plus não entra) e tamanho fora da grade fica de fora', () => {
    const q = quantidadesDaGrade(celulas, 'Regular', { M: 1 }, [{ cor: 'Preto', grades: 3 }]);
    expect(q).toEqual({ 'p-pre-m': '3' });
  });

  it('linhas do modelo com tamanhos e cores na ordem do cadastro', () => {
    expect(linhasDoModelo(celulas)).toEqual([
      {
        linha: 'Regular',
        tamanhos: ['M', 'G', 'GG'],
        cores: [
          { nome: 'Preto', hex: '#000000' },
          { nome: 'Bege', hex: '#000000' },
        ],
      },
      { linha: 'Plus Size', tamanhos: ['G1'], cores: [{ nome: 'Preto', hex: '#000000' }] },
    ]);
  });

  it('registro da grade (vai junto da OP): na ordem da grade; incompleta = null', () => {
    const r = registroDaGrade('Regular', ['M', 'G', 'GG'], { GG: 1, M: 2, G: 2 }, [
      { cor: 'Preto', grades: 20 },
      { cor: 'Bege', grades: 0 },
    ]);
    expect(r).toEqual({
      linha: 'Regular',
      composicao: [
        { tamanho: 'M', quantidade: 2 },
        { tamanho: 'G', quantidade: 2 },
        { tamanho: 'GG', quantidade: 1 },
      ],
      cores: [{ cor: 'Preto', grades: 20 }],
    });
    expect(textoDaGrade(r!.composicao)).toBe('2M 2G 1GG');
    expect(registroDaGrade('Regular', ['M'], {}, [{ cor: 'Preto', grades: 2 }])).toBeNull();
    expect(registroDaGrade('Regular', ['M'], { M: 1 }, [])).toBeNull();
  });
});
