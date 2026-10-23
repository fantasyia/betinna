import { describe, expect, it } from 'vitest';
import { acabamentoNoTamanho, acabamentoPorPeca, lerTamanhosServico } from './acabamento';

/** Acabamento por tamanho (Léo, 23/10): capuz infantil 2/4/6 sem cordão nem ilhós. */
const servicos = [
  { id: 'passar-cordao', nome: 'Passar cordão', preco: 0.25 },
  { id: 'ilhos', nome: 'Ilhós', preco: 0.25 },
  { id: 'dobrar', nome: 'Dobrar e embalar', preco: 0.25 },
];
const ids = ['passar-cordao', 'ilhos', 'dobrar'];
const so8a14 = { 'passar-cordao': ['8', '10', '12', '14'], ilhos: ['8', '10', '12', '14'] };
const grade = ['2', '4', '6', '8', '10', '12', '14'];

describe('acabamento por tamanho', () => {
  it('no tamanho 2 só conta o que não é restrito; no 8 conta tudo', () => {
    expect(acabamentoNoTamanho(ids, servicos, so8a14, '2')).toBeCloseTo(0.25, 6);
    expect(acabamentoNoTamanho(ids, servicos, so8a14, '8')).toBeCloseTo(0.75, 6);
  });

  it('previsto da grade = média por tamanho (3 tamanhos sem cordão nem ilhós)', () => {
    // (3 × 0,25 + 4 × 0,75) / 7
    expect(acabamentoPorPeca(ids, servicos, so8a14, grade)).toBeCloseTo((0.75 + 3) / 7, 6);
  });

  it('sem restrição, igual a antes (todos os serviços em todos os tamanhos)', () => {
    expect(acabamentoPorPeca(ids, servicos)).toBeCloseTo(0.75, 6);
    expect(acabamentoPorPeca(ids, servicos, null, grade)).toBeCloseTo(0.75, 6);
  });

  it('JSON estranho no banco vira "vale em todos"', () => {
    expect(lerTamanhosServico(null)).toBeNull();
    expect(lerTamanhosServico(['x'])).toBeNull();
    expect(lerTamanhosServico({ ilhos: ['8'], lixo: 3 })).toEqual({ ilhos: ['8'] });
  });
});
