import { describe, expect, it } from 'vitest';
import { copiarPrecos, lerPreco, montarCorpo, type Rascunho } from './ModeloEditor';
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
  { id: 'lin-plus', nome: 'Plus size', ordem: 1, ativo: true, tamanhos: [{ id: 't-g1', nome: 'G1', ordem: 0, ativo: true }] },
];

const vazioLinha = {
  marcada: false,
  tamanhoIds: [] as string[],
  precoEntrada: '',
  precoVolume: '',
  precoAtacadao: '',
  precoSugerido: '',
  colunas: [] as string[],
  medidas: {} as Record<string, string[]>,
};

const base = (): Rascunho => ({
  nome: 'Moletom',
  categoriaId: 'cat-1',
  descricao: '',
  etiquetas: 'Capuz, Gramatura 280',
  ativo: true,
  tituloMarketplace: '',
  descricaoMarketplace: '',
  composicao: '',
  corIds: ['cor-1'],
  linhas: {
    'lin-reg': {
      ...vazioLinha,
      marcada: true,
      tamanhoIds: ['t-p', 't-m'],
      precoEntrada: '39,90',
      precoSugerido: '79,90',
    },
    'lin-plus': { ...vazioLinha, marcada: true, tamanhoIds: ['t-g1'] },
  },
});

describe('montarCorpo', () => {
  it('monta o corpo: categoria por id, etiquetas separadas, "sob consulta" null', () => {
    const r = montarCorpo(base(), linhas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corpo.categoriaId).toBe('cat-1');
    expect(r.corpo.etiquetas).toEqual(['Capuz', 'Gramatura 280']);
    expect((r.corpo.linhas as unknown[])[0]).toEqual({
      linhaId: 'lin-reg',
      tamanhoIds: ['t-p', 't-m'],
      precoEntrada: 39.9,
      precoVolume: null,
      precoAtacadao: null,
      precoSugerido: 79.9,
      tabelaMedidas: null,
    });
  });

  it('sem categoria escolhida → null (não string vazia)', () => {
    const b = base();
    b.categoriaId = '';
    const r = montarCorpo(b, linhas);
    expect(r.ok && r.corpo.categoriaId).toBeNull();
  });

  it('linha marcada sem tamanho → erro, não envia', () => {
    const b = base();
    b.linhas['lin-reg'].tamanhoIds = [];
    expect(montarCorpo(b, linhas)).toEqual({ ok: false, erro: 'Marque ao menos um tamanho na linha Regular' });
  });

  it('preço digitado errado → erro, não envia', () => {
    const b = base();
    b.linhas['lin-reg'].precoVolume = '12,3,4';
    expect(montarCorpo(b, linhas).ok).toBe(false);
  });

  it('tabela de medidas em grade: coluna sem nome bloqueia; tamanho vazio fica de fora', () => {
    const b = base();
    b.linhas['lin-reg'].colunas = ['Tórax', ''];
    expect(montarCorpo(b, linhas).ok).toBe(false);

    b.linhas['lin-reg'].colunas = ['Tórax', 'Comprimento'];
    // M sem valor nenhum: não entra; P com só uma coluna: completa com "".
    b.linhas['lin-reg'].medidas = { P: ['50'], M: ['', ''] };
    const r = montarCorpo(b, linhas);
    expect(r.ok && (r.corpo.linhas as Array<{ tabelaMedidas: unknown }>)[0].tabelaMedidas).toEqual({
      colunas: ['Tórax', 'Comprimento'],
      linhas: [{ tamanho: 'P', valores: ['50', ''] }],
    });
  });

  it('linha desmarcada não vai no corpo', () => {
    const b = base();
    b.linhas['lin-plus'].marcada = false;
    const r = montarCorpo(b, linhas);
    expect(r.ok && (r.corpo.linhas as unknown[]).length).toBe(1);
  });
});

describe('copiarPrecos (item 9)', () => {
  it('copia os 4 preços de uma linha pra outra e não mexe em tamanhos/medidas', () => {
    const b = base();
    b.linhas['lin-plus'].colunas = ['Tórax'];
    const r = copiarPrecos(b, 'lin-reg', 'lin-plus');
    expect(r.linhas['lin-plus']).toMatchObject({
      precoEntrada: '39,90',
      precoSugerido: '79,90',
      tamanhoIds: ['t-g1'],
      colunas: ['Tórax'],
    });
    expect(b.linhas['lin-plus'].precoEntrada).toBe(''); // original intacto
  });
});
