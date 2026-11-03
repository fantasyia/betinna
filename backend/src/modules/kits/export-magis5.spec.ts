import { describe, expect, it } from 'vitest';
import {
  exportarKit,
  exportarPeca,
  resumirFaltas,
  type KitBase,
  type PecaBase,
} from './export-magis5';

const EMPRESA = {
  crt: '1',
  csosn: '102',
  cfopDentro: '5101',
  cfopFora: '6101',
  cfopForaNaoContribuinte: '6107',
  cstPisCofins: '49',
};

const peca = (over: Partial<PecaBase> = {}): PecaBase => ({
  id: 'v1',
  ativa: true,
  sku: 'BM-PT-M',
  skuSecundario: null,
  ean: '7890000000001',
  semGtin: false,
  modelo: 'Bermuda',
  cor: 'Preto',
  linha: 'Regular',
  tamanho: 'M',
  composicao: '100% algodão',
  descricao: 'Bermuda de moletom',
  preco: 79.99,
  custo: 16.29,
  ncm: '61034200',
  fiscal: {
    origem: '0',
    unidade: 'UN',
    marca: 'Ribelt',
    embalagemComprimentoCm: 30,
    embalagemLarguraCm: 20,
    embalagemAlturaCm: 5,
  },
  pesoGramas: 300,
  fotos: ['https://x/1.webp'],
  ...over,
});

const kit = (over: Partial<KitBase> = {}): KitBase => ({
  sku: 'KIT2-M',
  skuSecundario: null,
  nome: 'Kit 2 Bermudas',
  tamanho: 'M',
  aleatorio: false,
  composicaoOk: true,
  componentes: [
    { variacaoId: 'v1', quantidade: 1 },
    { variacaoId: 'v2', quantidade: 2 },
  ],
  ...over,
});

const mapa = (...ps: PecaBase[]) => new Map(ps.map((p) => [p.id, p]));

describe('exportação pro Magis5: peça (03/11)', () => {
  it('peça completa sai sem pendência e herda o padrão fiscal da empresa', () => {
    const r = exportarPeca(peca(), EMPRESA);
    expect(r.faltando).toEqual([]);
    expect(r.csosn).toBe('102');
    expect(r.cfopFora).toBe('6101');
    expect(r.nome).toBe('Bermuda Preto Regular M');
  });

  it('fiscal do produto vence o padrão da empresa', () => {
    const r = exportarPeca(peca({ fiscal: { ...peca().fiscal, csosn: '500' } }), EMPRESA);
    expect(r.csosn).toBe('500');
  });

  it('vazio não vira valor inventado: sai null e entra em faltando', () => {
    const r = exportarPeca(peca({ ncm: null, fiscal: null, pesoGramas: null }), null);
    expect(r.ncm).toBeNull();
    expect(r.csosn).toBeNull();
    expect(r.faltando).toEqual(
      expect.arrayContaining(['ncm', 'origem', 'csosn', 'pesoGramas', 'embalagem']),
    );
  });

  it('sem GTIN marcado não cobra EAN; sem marcar, cobra', () => {
    expect(exportarPeca(peca({ ean: null, semGtin: true }), EMPRESA).faltando).toEqual([]);
    expect(exportarPeca(peca({ ean: null }), EMPRESA).faltando).toEqual(['ean']);
  });
});

describe('exportação pro Magis5: kit (03/11)', () => {
  const v1 = peca();
  const v2 = peca({ id: 'v2', sku: 'BM-CZ-M', cor: 'Cinza', pesoGramas: 280 });

  it('fecha a composição e soma o peso pela quantidade', () => {
    const r = exportarKit(kit(), mapa(v1, v2), EMPRESA);
    expect(r.composicao).toEqual([
      { sku: 'BM-PT-M', quantidade: 1 },
      { sku: 'BM-CZ-M', quantidade: 2 },
    ]);
    expect(r.pesoGramas).toBe(860);
    expect(r.ncm).toBe('61034200');
    expect(r.faltando).toEqual([]);
  });

  it('NCM diferente entre as peças não escolhe um: fica null e aponta', () => {
    const r = exportarKit(kit(), mapa(v1, peca({ id: 'v2', ncm: '61046200' })), EMPRESA);
    expect(r.ncm).toBeNull();
    expect(r.faltando).toEqual(['ncm diverge entre as peças']);
  });

  it('aleatório sem composição sai sem composição e sem peso', () => {
    const r = exportarKit(
      kit({ aleatorio: true, composicaoOk: false, componentes: [] }),
      mapa(),
      EMPRESA,
    );
    expect(r.composicao).toBeNull();
    expect(r.pesoGramas).toBeNull();
    expect(r.faltando).toEqual(expect.arrayContaining(['composicao (aleatório)', 'pesoGramas']));
  });

  it('peça inativa ou sem SKU não deixa a composição sair', () => {
    for (const ruim of [peca({ id: 'v2', ativa: false }), peca({ id: 'v2', sku: null })]) {
      const r = exportarKit(kit(), mapa(v1, ruim), EMPRESA);
      expect(r.composicao).toBeNull();
      expect(r.faltando).toContain('composicao com peça sem SKU ou inativa');
    }
  });
});

describe('resumo do que falta (03/11)', () => {
  it('conta por campo, do mais comum pro menos', () => {
    const r = resumirFaltas([
      { faltando: ['ncm', 'ean'] },
      { faltando: ['ncm'] },
      { faltando: [] },
    ]);
    expect(r).toEqual({
      total: 3,
      completos: 1,
      faltas: [
        { campo: 'ncm', skus: 2 },
        { campo: 'ean', skus: 1 },
      ],
    });
  });
});
