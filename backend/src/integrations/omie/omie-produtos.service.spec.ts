import { describe, expect, it, vi, beforeEach } from 'vitest';
import { OmieProdutosService } from './omie-produtos.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  produto: {
    // Sync agora faz 1 findMany em lote (estado anterior) + 1 upsert por registro.
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({ id: 'prod-1' }),
  } satisfies MockModel,
  integracaoConexao: {
    findUnique: vi.fn().mockResolvedValue(null),
  } satisfies MockModel,
});

const makeOmieClientMock = () => ({
  listarProdutos: vi.fn(),
});

const makeIntegracoesMock = () => ({
  registrarSyncOk: vi.fn().mockResolvedValue({}),
});

vi.mock('./omie.mapper', () => ({
  OmieMapper: {
    produtoToPrismaUpsert: vi.fn((_empresaId: string, o: { codigo?: number }) => {
      if (!o.codigo) return null;
      return {
        where: { empresaId_codigoOmie: { empresaId: _empresaId, codigoOmie: String(o.codigo) } },
        create: { empresaId: _empresaId, codigoOmie: String(o.codigo), nome: 'Produto' },
        update: { nome: 'Produto' },
      };
    }),
    omieDateTimeToDate: vi.fn((_dAlt: string, _hAlt: string) => {
      return new Date(_dAlt ?? '2026-01-01');
    }),
  },
}));

const fakeProdutoOmie = (codigo: number, dataAlteracao = '2026-02-01') => ({
  codigo,
  data_alteracao: dataAlteracao,
  hora_alteracao: '10:00:00',
});

const fakeListarProdutosResponse = (
  produtos: ReturnType<typeof fakeProdutoOmie>[],
  totalPaginas = 1,
) => ({
  produto_servico_cadastro: produtos,
  total_de_paginas: totalPaginas,
  total_de_registros: produtos.length,
  pagina: 1,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('OmieProdutosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let omie: ReturnType<typeof makeOmieClientMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let service: OmieProdutosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    omie = makeOmieClientMock();
    integracoes = makeIntegracoesMock();
    service = new OmieProdutosService(prisma as never, omie as never, integracoes as never);
  });

  // -------------------------------------------------------------------------
  // sync — modo completo
  // -------------------------------------------------------------------------

  describe('sync (modo completo)', () => {
    it('retorna resultado com inseridos/atualizados/ignorados', async () => {
      omie.listarProdutos.mockResolvedValue(
        fakeListarProdutosResponse([fakeProdutoOmie(1), fakeProdutoOmie(2)]),
      );

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.modo).toBe('completo');
      expect(result.inseridos + result.atualizados).toBe(2);
      expect(result.totalProcessados).toBe(2);
    });

    it('não busca ultimoSync quando modo=completo', async () => {
      omie.listarProdutos.mockResolvedValue(fakeListarProdutosResponse([]));

      await service.sync('emp-1', { modo: 'completo' });

      expect(prisma.integracaoConexao.findUnique).not.toHaveBeenCalled();
    });

    it('atualiza produto quando já existe (upsert; contado como atualizado)', async () => {
      omie.listarProdutos.mockResolvedValue(fakeListarProdutosResponse([fakeProdutoOmie(1)]));
      // findMany em lote acha o produto existente (codigoOmie casa com o do mapper).
      prisma.produto.findMany.mockResolvedValue([
        { id: 'prod-existente', codigoOmie: '1', estoque: 10, nome: 'Produto' },
      ]);

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.atualizados).toBe(1);
      expect(result.inseridos).toBe(0);
      expect(prisma.produto.upsert).toHaveBeenCalledOnce();
    });

    it('insere produto quando não existe (upsert; contado como inserido)', async () => {
      omie.listarProdutos.mockResolvedValue(fakeListarProdutosResponse([fakeProdutoOmie(1)]));
      prisma.produto.findMany.mockResolvedValue([]); // nenhum existente

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.inseridos).toBe(1);
      expect(result.atualizados).toBe(0);
      expect(prisma.produto.upsert).toHaveBeenCalledOnce();
    });

    it('registra sync OK ao finalizar', async () => {
      omie.listarProdutos.mockResolvedValue(fakeListarProdutosResponse([]));

      await service.sync('emp-1', { modo: 'completo' });

      expect(integracoes.registrarSyncOk).toHaveBeenCalledWith('emp-1', 'omie');
    });

    it('itera múltiplas páginas', async () => {
      omie.listarProdutos
        .mockResolvedValueOnce(fakeListarProdutosResponse([fakeProdutoOmie(1)], 2))
        .mockResolvedValueOnce(fakeListarProdutosResponse([fakeProdutoOmie(2)], 2));

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(omie.listarProdutos).toHaveBeenCalledTimes(2);
      expect(result.totalProcessados).toBe(2);
      expect(result.paginas).toBe(2);
    });

    it('pula produto quando mapper retorna null (dados inválidos)', async () => {
      omie.listarProdutos.mockResolvedValue(fakeListarProdutosResponse([fakeProdutoOmie(0)]));

      const result = await service.sync('emp-1', { modo: 'completo' });

      expect(result.totalProcessados).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // sync — modo incremental
  // -------------------------------------------------------------------------

  describe('sync (modo incremental)', () => {
    it('usa modo incremental por padrão', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue({ ultimoSync: new Date('2026-01-15') });
      omie.listarProdutos.mockResolvedValue(fakeListarProdutosResponse([]));

      const result = await service.sync('emp-1');

      expect(result.modo).toBe('incremental');
    });

    it('ignora produtos com data_alteracao <= ultimoSync', async () => {
      const { OmieMapper } = await import('./omie.mapper');
      const ultimoSync = new Date('2026-01-15');
      prisma.integracaoConexao.findUnique.mockResolvedValue({ ultimoSync });
      vi.mocked(OmieMapper.omieDateTimeToDate).mockReturnValueOnce(new Date('2026-01-10'));

      omie.listarProdutos.mockResolvedValue(
        fakeListarProdutosResponse([fakeProdutoOmie(1, '2026-01-10')]),
      );

      const result = await service.sync('emp-1', { modo: 'incremental' });

      expect(result.ignorados).toBe(1);
      expect(result.totalProcessados).toBe(0);
    });

    it('processa produtos com data_alteracao > ultimoSync', async () => {
      const { OmieMapper } = await import('./omie.mapper');
      const ultimoSync = new Date('2026-01-15');
      prisma.integracaoConexao.findUnique.mockResolvedValue({ ultimoSync });
      vi.mocked(OmieMapper.omieDateTimeToDate).mockReturnValueOnce(new Date('2026-01-20'));

      omie.listarProdutos.mockResolvedValue(
        fakeListarProdutosResponse([fakeProdutoOmie(1, '2026-01-20')]),
      );

      const result = await service.sync('emp-1', { modo: 'incremental' });

      expect(result.ignorados).toBe(0);
      expect(result.totalProcessados).toBe(1);
    });

    it('processa todos quando ultimoSync é null (primeiro sync)', async () => {
      prisma.integracaoConexao.findUnique.mockResolvedValue(null);
      omie.listarProdutos.mockResolvedValue(
        fakeListarProdutosResponse([fakeProdutoOmie(1), fakeProdutoOmie(2)]),
      );

      const result = await service.sync('emp-1', { modo: 'incremental' });

      expect(result.totalProcessados).toBe(2);
      expect(result.ignorados).toBe(0);
    });
  });
});
