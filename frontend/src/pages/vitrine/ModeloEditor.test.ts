import { describe, expect, it } from 'vitest';
import { lerPreco, montarCorpo } from './ModeloEditor';
import type { Linha } from './tipos';

describe('lerPreco', () => {
  it('aceita vírgula brasileira, ponto e "R$"', () => {
    expect(lerPreco('39,90')).toBe(39.9);
    expect(lerPreco('39.9')).toBe(39.9);
    expect(lerPreco('R$ 1.234,50')).toBe(1234.5);
  });

  it('vazio é "sob consulta" (null), não zero', () => {
    expect(lerPreco('')).toBeNull();
    expect(lerPreco('   ')).toBeNull();
  });

  it('texto inválido ou negativo vira NaN (bloqueia o envio)', () => {
    expect(lerPreco('abc')).toBeNaN();
    expect(lerPreco('-5')).toBeNaN();
  });
});

const linhas: Linha[] = [
  {
    id: 'lin-reg',
    nome: 'Regular',
    ordem: 0,
    ativo: true,
    tamanhos: [
      { id: 't-p', nome: 'P', ordem: 0, ativo: true },
      { id: 't-m', nome: 'M', ordem: 1, ativo: true },
    ],
  },
];

const base = () => ({
  nome: 'Moletom',
  categoria: '',
  descricao: '',
  etiquetas: 'Capuz, Gramatura 280',
  ativo: true,
  tituloMarketplace: '',
  descricaoMarketplace: '',
  composicao: '',
  corIds: ['cor-1'],
  linhas: {
    'lin-reg': {
      marcada: true,
      tamanhoIds: ['t-p', 't-m'],
      precoEntrada: '39,90',
      precoVolume: '',
      precoAtacadao: '',
      precoSugerido: '79,90',
      colunas: '',
      medidas: {},
    },
  },
});

describe('montarCorpo', () => {
  it('monta o corpo com etiquetas separadas, preços em número e "sob consulta" null', () => {
    const r = montarCorpo(base(), linhas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corpo.etiquetas).toEqual(['Capuz', 'Gramatura 280']);
    expect(r.corpo.linhas).toEqual([
      {
        linhaId: 'lin-reg',
        tamanhoIds: ['t-p', 't-m'],
        precoEntrada: 39.9,
        precoVolume: null,
        precoAtacadao: null,
        precoSugerido: 79.9,
        tabelaMedidas: null,
      },
    ]);
  });

  it('linha marcada sem tamanho → erro, não envia', () => {
    const b = base();
    b.linhas['lin-reg'].tamanhoIds = [];
    expect(montarCorpo(b, linhas)).toEqual({ ok: false, erro: 'Marque ao menos um tamanho na linha Regular' });
  });

  it('preço digitado errado → erro, não envia', () => {
    const b = base();
    b.linhas['lin-reg'].precoVolume = '12,3,4';
    const r = montarCorpo(b, linhas);
    expect(r.ok).toBe(false);
  });

  it('tabela de medidas: um valor por coluna em cada tamanho preenchido', () => {
    const b = base();
    b.linhas['lin-reg'].colunas = 'Tórax, Comprimento';
    b.linhas['lin-reg'].medidas = { P: '50, 70', M: '53' };
    const r = montarCorpo(b, linhas);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain('M');

    b.linhas['lin-reg'].medidas = { P: '50, 70', M: '53, 72' };
    const ok = montarCorpo(b, linhas);
    expect(ok.ok && ok.corpo.linhas).toEqual([
      expect.objectContaining({
        tabelaMedidas: {
          colunas: ['Tórax', 'Comprimento'],
          linhas: [
            { tamanho: 'P', valores: ['50', '70'] },
            { tamanho: 'M', valores: ['53', '72'] },
          ],
        },
      }),
    ]);
  });

  it('linha desmarcada não vai no corpo', () => {
    const b = base();
    b.linhas['lin-reg'].marcada = false;
    const r = montarCorpo(b, linhas);
    expect(r.ok && r.corpo.linhas).toEqual([]);
  });
});
