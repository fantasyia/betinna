import { describe, expect, it } from 'vitest';
import { enfestoPorCor, gradeCorTamanho, pecasPorTamanho, qtdUn, totalDoItem, type ItemGrade } from './fichaImpressao';

/** Ficha da OP impressa (Léo, 14/10): grade, totais por tamanho e enfesto. */

const it_ = (cor: string, tamanho: string, ordem: number, planejada: number, linha = 'Regular'): ItemGrade => ({
  modeloLinhaId: linha === 'Regular' ? 'ml-reg' : 'ml-inf',
  linha,
  linhaOrdem: linha === 'Regular' ? 1 : 0,
  cor,
  corOrdem: cor === 'Preto' ? 0 : 1,
  tamanho,
  tamanhoOrdem: ordem,
  planejada,
});
const itens = [it_('Preto', 'M', 1, 40), it_('Preto', 'P', 0, 20), it_('Bege', 'M', 1, 20), it_('Bege', 'G', 2, 20)];

describe('ficha impressa', () => {
  it('grade cor × tamanho na ordem, com totais', () => {
    const g = gradeCorTamanho(itens);
    expect(g.tamanhos).toEqual(['P', 'M', 'G']);
    expect(g.linhas.map((l) => [l.cor, l.total])).toEqual([
      ['Preto', 60],
      ['Bege', 40],
    ]);
    expect(g.totalPorTam).toEqual({ P: 20, M: 60, G: 20 });
    expect(g.total).toBe(100);
  });

  it('elástico por tamanho: Σ peças do tamanho × medida dele (o médio onde falta)', () => {
    const el = { consumoPorPeca: 0.8, porTamanho: { P: 0.76, G: 0.84 } };
    expect(totalDoItem(el, pecasPorTamanho(itens, 'ml-reg'))).toBeCloseTo(20 * 0.76 + 60 * 0.8 + 20 * 0.84, 6);
    expect(totalDoItem({ consumoPorPeca: 2, porTamanho: null }, { M: 10 })).toBe(20); // 2 ilhós × 10
  });

  it('enfesto por cor: folhas = peças da cor ÷ peças do risco; metros = comprimento × folhas', () => {
    const r = enfestoPorCor(itens, { linha: 'Regular', composicao: [{ quantidade: 4 }], comprimentoM: 3.1 });
    expect(r).toEqual([
      { cor: 'Preto', folhas: 15, metros: 46.5 },
      { cor: 'Bege', folhas: 10, metros: 31 },
    ]);
  });

  it('quantidade na unidade do insumo, em pt-BR', () => {
    expect(qtdUn(48.4, 'METRO')).toBe('48,4 m');
    expect(qtdUn(200, 'UNIDADE')).toBe('200 un');
  });
});
