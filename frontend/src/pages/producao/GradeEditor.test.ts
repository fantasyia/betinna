import { describe, expect, it } from 'vitest';
import { agrupar, inteiro, totalGrade, type CelulaGrade } from './GradeEditor';

const c = (produtoId: string, cor: string, corOrdem: number, linha: string, tam: string, tamOrdem: number): CelulaGrade => ({
  produtoId,
  cor: { nome: cor, hex: '#000000' },
  corOrdem,
  linha,
  linhaOrdem: linha === 'Regular' ? 0 : 1,
  tamanho: tam,
  tamanhoOrdem: tamOrdem,
});

describe('grade da OP', () => {
  it('agrupa por linha, cores × tamanhos na ordem do cadastro; buraco = null', () => {
    const [reg, plus] = agrupar([
      c('a', 'Preto', 1, 'Regular', 'M', 1),
      c('b', 'Azul', 0, 'Regular', 'P', 0),
      c('d', 'Preto', 1, 'Regular', 'P', 0),
      c('e', 'Preto', 1, 'Plus', 'G1', 0),
    ]);
    expect(reg.tamanhos).toEqual(['P', 'M']);
    expect(reg.cores.map((x) => x.cor.nome)).toEqual(['Azul', 'Preto']);
    expect(reg.cores[0].celulas.map((x) => x?.produtoId ?? null)).toEqual(['b', null]);
    expect(plus.linha).toBe('Plus');
  });
  it('soma e lê números digitados', () => {
    expect(totalGrade({ a: '10', b: '', c: '3' })).toBe(13);
    expect(inteiro('1.200')).toBe(1200);
    expect(inteiro(undefined)).toBe(0);
  });
});
