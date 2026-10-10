import { describe, expect, it } from 'vitest';
import {
  avisoDaGrade,
  paresDe,
  preencherConjunto,
  sugestoesAntesDePagar,
  type ModeloPub,
} from './calculo';

/** Upsell da vitrine (Léo, 09/10): conjunto + sugestões antes de pagar, sem desconto. */

const linha = (id: string, linhaId: string, tams: Array<[string, string]>) => ({
  id,
  linhaId,
  nome: linhaId,
  tamanhos: tams.map(([tid, tamanhoId]) => ({ id: tid, tamanhoId, nome: tamanhoId })),
  precoEntrada: 50,
  precoVolume: null,
  precoAtacadao: null,
  precoSugerido: null,
  tabelaMedidas: null,
});
const cor = (id: string, corId: string) => ({ id, corId, nome: corId, hex: '#000', fotos: [] });
const modelo = (id: string, extra: Partial<ModeloPub> = {}): ModeloPub => ({
  id,
  nome: id,
  categoria: null,
  descricao: null,
  etiquetas: [],
  tituloMarketplace: null,
  descricaoMarketplace: null,
  composicao: null,
  cores: [],
  linhas: [],
  videos: [],
  ...extra,
});

const blusa = modelo('blusa', {
  cores: [cor('b-preto', 'PRETO'), cor('b-cinza', 'CINZA')],
  linhas: [
    linha('b-reg', 'REG', [
      ['b-p', 'P'],
      ['b-m', 'M'],
    ]),
  ],
  combinaCom: ['calca'],
});
const calca = modelo('calca', {
  cores: [cor('c-preto', 'PRETO')],
  linhas: [
    linha('c-reg', 'REG', [
      ['c-p', 'P'],
      ['c-m', 'M'],
    ]),
  ],
  combinaCom: ['blusa'],
});

describe('preencherConjunto', () => {
  it('copia a grade pro par: mesma cor da lista, mesma linha e mesmo tamanho', () => {
    const r = preencherConjunto(blusa, calca, { blusa: { 'b-preto': { 'b-p': 2, 'b-m': 3 } } });
    expect(r.pecas).toBe(5);
    expect(r.carrinho.calca).toEqual({ 'c-preto': { 'c-p': 2, 'c-m': 3 } });
  });

  it('cor que o par não tem fica de fora (cinza); nada em comum = carrinho igual', () => {
    const c = { blusa: { 'b-cinza': { 'b-p': 4 } } };
    const r = preencherConjunto(blusa, calca, c);
    expect(r).toEqual({ carrinho: c, pecas: 0 });
  });

  it('não sobrescreve o que o lojista já pôs no par', () => {
    const r = preencherConjunto(blusa, calca, {
      blusa: { 'b-preto': { 'b-p': 2, 'b-m': 3 } },
      calca: { 'c-preto': { 'c-p': 10 } },
    });
    expect(r.carrinho.calca).toEqual({ 'c-preto': { 'c-p': 10, 'c-m': 3 } });
    expect(r.pecas).toBe(3);
  });

  it('respeita o estoque do par', () => {
    const comEstoque = { ...calca, estoque: { 'c-preto': { 'c-p': 1, 'c-m': 0 } } };
    const r = preencherConjunto(blusa, comEstoque, {
      blusa: { 'b-preto': { 'b-p': 2, 'b-m': 3 } },
    });
    expect(r.carrinho.calca).toEqual({ 'c-preto': { 'c-p': 1 } });
  });
});

describe('sugestoesAntesDePagar', () => {
  const bermuda = modelo('bermuda', { cores: [cor('x', 'PRETO')] });
  const camiseta = modelo('camiseta', { cores: [cor('y', 'PRETO')] });
  const regata = modelo('regata', { cores: [cor('z', 'PRETO')] });
  const v = { modelos: [bermuda, camiseta, regata, blusa, calca] };

  it('primeiro o que combina com o pedido, depois o resto; nunca o que já está nele; até 3', () => {
    const s = sugestoesAntesDePagar(v, { blusa: { 'b-preto': { 'b-p': 1 } } });
    expect(s.map((m) => m.id)).toEqual(['calca', 'bermuda', 'camiseta']);
  });

  it('pedido vazio: nenhuma sugestão', () => {
    expect(sugestoesAntesDePagar(v, {})).toEqual([]);
  });

  it('paresDe: só modelos que estão na vitrine', () => {
    expect(paresDe(blusa, { modelos: [blusa] })).toEqual([]);
    expect(paresDe(blusa, v).map((m) => m.id)).toEqual(['calca']);
  });
});

describe('avisoDaGrade (10/10)', () => {
  it('diz o que mudou naquele modelo; nada mudou = sem aviso', () => {
    expect(avisoDaGrade('Bermuda Moletom Summer', 12)).toBe('+12 peças · Bermuda Moletom Summer');
    expect(avisoDaGrade('Calça Moletom', 1)).toBe('+1 peça · Calça Moletom');
    expect(avisoDaGrade('Calça Moletom', -3)).toBe('−3 peças · Calça Moletom');
    expect(avisoDaGrade('Calça Moletom', 0)).toBeNull();
  });
});
