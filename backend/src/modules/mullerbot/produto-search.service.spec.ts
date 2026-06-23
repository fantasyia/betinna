import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProdutoSearchService } from './produto-search.service';

const makePrisma = (produtos: unknown[]) => ({
  produto: { findMany: vi.fn(async () => produtos) },
});

// Sem chave de embedding → buscar() cai no fallback keyword (o que estes testes cobrem).
const fakeEmbed = { gerar: vi.fn(async () => null) };

const PROD_OLEO = {
  id: 'p1',
  nome: 'Óleo de Girassol 5L',
  descricao: 'Óleo de girassol refinado, garrafa 5 litros',
  marca: 'Soya',
  linha: 'Alimentos',
  categoria: 'Óleos',
  unidade: 'UN',
  precoTabela: 48,
  sku: 'OLE-GIR-5L',
  codigoOmie: '2001',
};
const PROD_AZEITE = {
  id: 'p2',
  nome: 'Azeite Extra Virgem 500ml',
  descricao: 'Azeite extra virgem importado',
  marca: 'Borges',
  linha: 'Alimentos',
  categoria: 'Óleos',
  unidade: 'UN',
  precoTabela: 42.5,
  sku: 'AZE-EXT-500',
  codigoOmie: '2002',
};
const PROD_FARINHA = {
  id: 'p3',
  nome: 'Farinha de Trigo Tipo 1 1kg',
  descricao: 'Farinha branca para panificação',
  marca: 'Dona Benta',
  linha: 'Alimentos',
  categoria: 'Farinhas',
  unidade: 'UN',
  precoTabela: 6.9,
  sku: 'FAR-TRI-1K',
  codigoOmie: '2003',
};

describe('ProdutoSearchService.tokenize', () => {
  let svc: ProdutoSearchService;
  beforeEach(() => {
    svc = new ProdutoSearchService(makePrisma([]) as never, fakeEmbed as never);
  });

  it('remove acentos, lowercase, filtra stopwords e tokens curtos', () => {
    const tokens = svc.tokenize('Você tem ÓLEO de girassol?');
    expect(tokens).toEqual(['oleo', 'girassol']);
  });

  it('considera SKU como token quando alfanumérico ≥3', () => {
    const tokens = svc.tokenize('tem o OLE-GIR-5L em estoque?');
    // hífen é separador → 'ole', 'gir', '5l'(2 chars filtra)
    expect(tokens).toContain('ole');
    expect(tokens).toContain('gir');
    expect(tokens).toContain('estoque');
  });
});

describe('ProdutoSearchService.buscar', () => {
  it('ranqueia óleo acima de azeite quando pergunta menciona "girassol"', async () => {
    const svc = new ProdutoSearchService(
      makePrisma([PROD_AZEITE, PROD_OLEO, PROD_FARINHA]) as never,
      fakeEmbed as never,
    );
    const r = await svc.buscar('emp-1', 'preciso de óleo de girassol');
    expect(r[0].id).toBe('p1'); // óleo
    expect(r[0].score).toBeGreaterThan(0);
    expect(r[0].matches.some((m) => m.includes('girassol'))).toBe(true);
  });

  it('retorna vazio quando nenhum token relevante bate', async () => {
    const svc = new ProdutoSearchService(
      makePrisma([PROD_AZEITE, PROD_OLEO]) as never,
      fakeEmbed as never,
    );
    const r = await svc.buscar('emp-1', 'oi tudo bem?'); // só stopwords
    expect(r).toHaveLength(0);
  });

  it('respeita o limit (top-K)', async () => {
    const svc = new ProdutoSearchService(
      makePrisma([PROD_OLEO, PROD_AZEITE, PROD_FARINHA]) as never,
      fakeEmbed as never,
    );
    const r = await svc.buscar('emp-1', 'alimentos para padaria', 2);
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it('marca match em campo nome com peso maior', async () => {
    const svc = new ProdutoSearchService(makePrisma([PROD_OLEO]) as never, fakeEmbed as never);
    const r = await svc.buscar('emp-1', 'girassol');
    // 'girassol' aparece em nome (peso 3) e descricao (peso 1) → score >= 4
    expect(r[0].score).toBeGreaterThanOrEqual(4);
  });

  it('filtra produtos inativos via where do Prisma (não traz ativo:false)', async () => {
    const prisma = makePrisma([]);
    const svc = new ProdutoSearchService(prisma as never, fakeEmbed as never);
    await svc.buscar('emp-1', 'qualquer');
    expect(prisma.produto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresaId: 'emp-1', ativo: true },
      }),
    );
  });
});
