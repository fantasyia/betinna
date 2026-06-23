import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma, type UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { ProdutosService } from './produtos.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  produto: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  } satisfies MockModel,
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeProduto = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  empresaId: 'emp-1',
  nome: 'Óleo 5L',
  sku: 'OLE-5L',
  codigoOmie: null,
  marca: 'Soya',
  linha: 'Alimentos',
  categoria: 'Óleos',
  unidade: 'UN',
  imagem: null,
  descricao: null,
  precoTabela: 50,
  precoFabrica: 40,
  popularidade: 5,
  estoque: 100,
  ativo: true,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  _count: { precosEspeciais: 0, pedidoItens: 0 },
  ...overrides,
});

const makeP2003 = () =>
  new Prisma.PrismaClientKnownRequestError('Foreign key violation', {
    code: 'P2003',
    clientVersion: '6.0.0',
  });

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ProdutosService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ProdutosService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ProdutosService(
      prisma as never,
      {
        enfileirarProduto: vi.fn(async () => undefined),
      } as never,
    );
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const baseParams = {
      page: 1,
      limit: 20,
      sortBy: 'criadoEm' as const,
      sortOrder: 'desc' as const,
    };

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.list(fakeUser({ empresaIdAtiva: null }), baseParams),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sempre inclui empresaId no AND', async () => {
      prisma.produto.count.mockResolvedValue(0);
      prisma.produto.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ empresaIdAtiva: 'emp-5' }), baseParams);

      const args = prisma.produto.findMany.mock.calls[0][0];
      const firstCond = (args.where.AND as Array<Record<string, unknown>>)[0];
      expect(firstCond).toEqual({ empresaId: 'emp-5' });
    });

    it('filtra por search em nome/sku/codigoOmie/marca (OR)', async () => {
      prisma.produto.count.mockResolvedValue(0);
      prisma.produto.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, search: 'oleo' });

      const args = prisma.produto.findMany.mock.calls[0][0];
      const conds = args.where.AND as Array<Record<string, unknown>>;
      const searchCond = conds.find((c) => 'OR' in c) as { OR: unknown[] } | undefined;
      expect(searchCond).toBeDefined();
      expect(searchCond!.OR).toHaveLength(4);
    });

    it('filtra por linha', async () => {
      prisma.produto.count.mockResolvedValue(0);
      prisma.produto.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, linha: 'Alimentos' });

      const args = prisma.produto.findMany.mock.calls[0][0];
      const conds = args.where.AND as Array<Record<string, unknown>>;
      expect(conds).toEqual(expect.arrayContaining([{ linha: 'Alimentos' }]));
    });

    it('filtra por ativo=false (inativos)', async () => {
      prisma.produto.count.mockResolvedValue(0);
      prisma.produto.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, ativo: false });

      const args = prisma.produto.findMany.mock.calls[0][0];
      const conds = args.where.AND as Array<Record<string, unknown>>;
      expect(conds).toEqual(expect.arrayContaining([{ ativo: false }]));
    });

    it('filtra sem estoque (estoque=0)', async () => {
      prisma.produto.count.mockResolvedValue(0);
      prisma.produto.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, semEstoque: true });

      const args = prisma.produto.findMany.mock.calls[0][0];
      const conds = args.where.AND as Array<Record<string, unknown>>;
      expect(conds).toEqual(expect.arrayContaining([{ estoque: 0 }]));
    });

    it('filtra por faixa de preço', async () => {
      prisma.produto.count.mockResolvedValue(0);
      prisma.produto.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, precoMin: 10, precoMax: 100 });

      const args = prisma.produto.findMany.mock.calls[0][0];
      const conds = args.where.AND as Array<Record<string, unknown>>;
      expect(conds).toEqual(expect.arrayContaining([{ precoTabela: { gte: 10 } }]));
      expect(conds).toEqual(expect.arrayContaining([{ precoTabela: { lte: 100 } }]));
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna produto quando encontrado', async () => {
      const p = fakeProduto();
      prisma.produto.findFirst.mockResolvedValue(p);

      const result = await service.findById(fakeUser(), 'p-1');

      expect(result).toEqual(p);
    });

    it('lança NotFoundException quando não existe', async () => {
      prisma.produto.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('filtra por empresaId no findFirst', async () => {
      prisma.produto.findFirst.mockResolvedValue(fakeProduto());

      await service.findById(fakeUser({ empresaIdAtiva: 'emp-2' }), 'p-1');

      const args = prisma.produto.findFirst.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-2');
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    const baseDto = {
      nome: 'Produto A',
      precoTabela: 50,
      precoFabrica: 40,
      unidade: 'UN',
      popularidade: 3,
      estoque: 100,
      ativo: true,
    };

    it('cria produto com empresaId do JWT', async () => {
      prisma.produto.findUnique.mockResolvedValue(null); // sku/omie únicos
      prisma.produto.create.mockResolvedValue(fakeProduto());

      await service.create(fakeUser({ empresaIdAtiva: 'emp-1' }), baseDto);

      const data = prisma.produto.create.mock.calls[0][0].data;
      expect(data.empresaId).toBe('emp-1');
    });

    it('lança BusinessRuleException quando precoFabrica > precoTabela', async () => {
      await expect(
        service.create(fakeUser(), { ...baseDto, precoFabrica: 60, precoTabela: 50 }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.produto.create).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException para SKU duplicado na empresa', async () => {
      prisma.produto.findUnique.mockResolvedValue({ id: 'p-existente' }); // SKU já existe

      await expect(
        service.create(fakeUser(), { ...baseDto, sku: 'OLE-5L' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.produto.create).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException para codigoOmie duplicado', async () => {
      // create sem sku → apenas assertCodigoOmieUnico é chamado (1 findUnique)
      prisma.produto.findUnique.mockResolvedValueOnce({ id: 'p-existente' }); // omie check: conflito

      await expect(
        service.create(fakeUser(), { ...baseDto, codigoOmie: '12345' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza produto existente', async () => {
      const p = fakeProduto({ precoTabela: 50, precoFabrica: 40 });
      const updated = fakeProduto({ nome: 'Produto Atualizado' });
      prisma.produto.findFirst.mockResolvedValue(p);
      prisma.produto.updateMany.mockResolvedValue({ count: 1 });
      prisma.produto.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.update(fakeUser(), 'p-1', { nome: 'Produto Atualizado' });

      expect(result.nome).toBe('Produto Atualizado');
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      const p = fakeProduto({ empresaId: 'emp-1' });
      prisma.produto.findFirst.mockResolvedValue(p);
      prisma.produto.updateMany.mockResolvedValue({ count: 1 });
      prisma.produto.findUniqueOrThrow.mockResolvedValue(p);

      await service.update(fakeUser(), 'p-1', { nome: 'X' });

      const args = prisma.produto.updateMany.mock.calls[0][0];
      expect(args.where.id).toBe('p-1');
      expect(args.where.empresaId).toBe('emp-1');
    });

    it('lança BusinessRuleException quando novo precoFabrica > precoTabela existente', async () => {
      const p = fakeProduto({ precoTabela: 50, precoFabrica: 40 });
      prisma.produto.findFirst.mockResolvedValue(p);

      await expect(service.update(fakeUser(), 'p-1', { precoFabrica: 60 })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(prisma.produto.updateMany).not.toHaveBeenCalled();
    });

    it('não valida SKU se não mudou', async () => {
      const p = fakeProduto({ sku: 'OLE-5L' });
      prisma.produto.findFirst.mockResolvedValue(p);
      prisma.produto.updateMany.mockResolvedValue({ count: 1 });
      prisma.produto.findUniqueOrThrow.mockResolvedValue(p);

      await service.update(fakeUser(), 'p-1', { sku: 'OLE-5L' }); // mesmo SKU

      // findUnique para assertSkuUnico não deve ter sido chamado
      expect(prisma.produto.findUnique).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // updateEstoque
  // -------------------------------------------------------------------------

  describe('updateEstoque', () => {
    it('atualiza estoque com TOCTOU protection', async () => {
      const p = fakeProduto({ empresaId: 'emp-1' });
      prisma.produto.findFirst.mockResolvedValue(p);
      prisma.produto.updateMany.mockResolvedValue({ count: 1 });
      prisma.produto.findUniqueOrThrow.mockResolvedValue(fakeProduto({ estoque: 50 }));

      const result = await service.updateEstoque(fakeUser(), 'p-1', { estoque: 50 });

      expect(result.estoque).toBe(50);
      const args = prisma.produto.updateMany.mock.calls[0][0];
      expect(args.data.estoque).toBe(50);
      expect(args.where.empresaId).toBe('emp-1');
    });
  });

  // -------------------------------------------------------------------------
  // setAtivo
  // -------------------------------------------------------------------------

  describe('setAtivo', () => {
    it('desativa produto', async () => {
      const p = fakeProduto({ ativo: true, empresaId: 'emp-1' });
      prisma.produto.findFirst.mockResolvedValue(p);
      prisma.produto.updateMany.mockResolvedValue({ count: 1 });
      prisma.produto.findUniqueOrThrow.mockResolvedValue(fakeProduto({ ativo: false }));

      const result = await service.setAtivo(fakeUser(), 'p-1', { ativo: false });

      expect(result.ativo).toBe(false);
      const args = prisma.produto.updateMany.mock.calls[0][0];
      expect(args.data.ativo).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('remove produto sem pedidos vinculados', async () => {
      const p = fakeProduto({ empresaId: 'emp-1' });
      prisma.produto.findFirst.mockResolvedValue(p);
      prisma.produto.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.remove(fakeUser(), 'p-1')).resolves.toBeUndefined();

      const args = prisma.produto.deleteMany.mock.calls[0][0];
      expect(args.where.id).toBe('p-1');
      expect(args.where.empresaId).toBe('emp-1');
    });

    it('lança BusinessRuleException (P2003) quando há pedidos vinculados', async () => {
      const p = fakeProduto();
      prisma.produto.findFirst.mockResolvedValue(p);
      prisma.produto.deleteMany.mockRejectedValue(makeP2003());

      await expect(service.remove(fakeUser(), 'p-1')).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('relança erros que não são P2003', async () => {
      const p = fakeProduto();
      prisma.produto.findFirst.mockResolvedValue(p);
      const internalError = new Error('DB timeout');
      prisma.produto.deleteMany.mockRejectedValue(internalError);

      await expect(service.remove(fakeUser(), 'p-1')).rejects.toBe(internalError);
    });

    it('lança NotFoundException quando produto não existe', async () => {
      prisma.produto.findFirst.mockResolvedValue(null);

      await expect(service.remove(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // facets
  // -------------------------------------------------------------------------

  describe('facets', () => {
    it('retorna valores únicos de linha/categoria/marca ordenados', async () => {
      prisma.produto.findMany.mockResolvedValue([
        { linha: 'Bebidas', categoria: 'Sucos', marca: 'Del Valle' },
        { linha: 'Alimentos', categoria: 'Óleos', marca: 'Soya' },
        { linha: 'Bebidas', categoria: null, marca: 'Soya' }, // duplicado + null
      ]);

      const result = await service.facets(fakeUser());

      expect(result.linhas).toEqual(['Alimentos', 'Bebidas']); // sorted, deduped
      // 'Ó' (U+00D3=211) > 'S' (U+0053=83), logo sort() coloca 'Sucos' antes de 'Óleos'
      expect(result.categorias).toEqual(['Sucos', 'Óleos']); // null filtrado
      expect(result.marcas).toEqual(['Del Valle', 'Soya']); // sorted, deduped
    });

    it('filtra apenas produtos ativos da empresa', async () => {
      prisma.produto.findMany.mockResolvedValue([]);

      await service.facets(fakeUser({ empresaIdAtiva: 'emp-3' }));

      const args = prisma.produto.findMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-3');
      expect(args.where.ativo).toBe(true);
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(service.facets(fakeUser({ empresaIdAtiva: null }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
