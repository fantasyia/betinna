import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CatalogoService } from './catalogo.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

const makePrismaMock = () => ({
  repCatalogoItem: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  } satisfies MockModel,
  produto: {
    findFirst: vi.fn(),
    count: vi.fn(),
  } satisfies MockModel,
  $transaction: vi.fn(async (ops: unknown[]) => ops), // returns array for batch upsert
});

const makeClientesMock = () => ({
  findById: vi.fn(),
});

const makePricingMock = () => ({
  priceForClientBatch: vi.fn(async () => new Map()),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'rep-1',
  email: 'rep@betinna.ai',
  nome: 'Rep Teste',
  role: 'REP' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeCatalogoItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'cat-1',
  usuarioId: 'rep-1',
  produtoId: 'p-1',
  markup: 10,
  produto: {
    id: 'p-1',
    nome: 'Óleo 5L',
    sku: 'OLE-5L',
    marca: 'Soya',
    linha: 'Alimentos',
    unidade: 'UN',
    imagem: null,
    precoTabela: 50,
    precoFabrica: 40,
    popularidade: 5,
    ativo: true,
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CatalogoService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let clientes: ReturnType<typeof makeClientesMock>;
  let pricing: ReturnType<typeof makePricingMock>;
  let service: CatalogoService;

  beforeEach(() => {
    prisma = makePrismaMock();
    clientes = makeClientesMock();
    pricing = makePricingMock();
    service = new CatalogoService(prisma as never, clientes as never, pricing as never);
  });

  // -------------------------------------------------------------------------
  // listMyCatalog
  // -------------------------------------------------------------------------

  describe('listMyCatalog', () => {
    it('retorna itens do catálogo do usuário', async () => {
      const items = [fakeCatalogoItem()];
      prisma.repCatalogoItem.findMany.mockResolvedValue(items);

      const result = await service.listMyCatalog(fakeUser());

      expect(result).toEqual(items);
    });

    it('filtra por usuarioId e produto ativo da empresa', async () => {
      prisma.repCatalogoItem.findMany.mockResolvedValue([]);

      await service.listMyCatalog(fakeUser({ id: 'rep-77', empresaIdAtiva: 'emp-2' }));

      const args = prisma.repCatalogoItem.findMany.mock.calls[0][0];
      expect(args.where.usuarioId).toBe('rep-77');
      expect(args.where.produto.empresaId).toBe('emp-2');
      expect(args.where.produto.ativo).toBe(true);
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.listMyCatalog(fakeUser({ empresaIdAtiva: null })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // upsertItem
  // -------------------------------------------------------------------------

  describe('upsertItem', () => {
    it('faz upsert de item com markup', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p-1' });
      const item = fakeCatalogoItem({ markup: 15 });
      prisma.repCatalogoItem.upsert.mockResolvedValue(item);

      const result = await service.upsertItem(fakeUser(), { produtoId: 'p-1', markup: 15 });

      expect(result.markup).toBe(15);
      const args = prisma.repCatalogoItem.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        usuarioId_produtoId: { usuarioId: 'rep-1', produtoId: 'p-1' },
      });
      expect(args.create.markup).toBe(15);
      expect(args.update.markup).toBe(15);
    });

    it('lança BusinessRuleException se produto não pertence à empresa ou está inativo', async () => {
      prisma.produto.findFirst.mockResolvedValue(null);

      await expect(
        service.upsertItem(fakeUser(), { produtoId: 'p-inexistente', markup: 10 }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.repCatalogoItem.upsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // bulkUpsert
  // -------------------------------------------------------------------------

  describe('bulkUpsert', () => {
    it('processa múltiplos itens em transação', async () => {
      prisma.produto.count.mockResolvedValue(2); // 2 pedidos, 2 encontrados
      prisma.$transaction.mockResolvedValue([]);

      const result = await service.bulkUpsert(fakeUser(), {
        itens: [
          { produtoId: 'p-1', markup: 10 },
          { produtoId: 'p-2', markup: 15 },
        ],
      });

      expect(result).toEqual({ ok: true, processados: 2 });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('lança BusinessRuleException se algum produto não pertence à empresa', async () => {
      prisma.produto.count.mockResolvedValue(1); // pediu 2, achou 1

      await expect(
        service.bulkUpsert(fakeUser(), {
          itens: [
            { produtoId: 'p-1', markup: 10 },
            { produtoId: 'p-outro-tenant', markup: 5 },
          ],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deduplica produtoIds ao validar (Set)', async () => {
      prisma.produto.count.mockResolvedValue(1); // 1 único produto
      prisma.$transaction.mockResolvedValue([]);

      await service.bulkUpsert(fakeUser(), {
        itens: [
          { produtoId: 'p-1', markup: 10 },
          { produtoId: 'p-1', markup: 12 }, // duplicado
        ],
      });

      const countArgs = prisma.produto.count.mock.calls[0][0];
      expect(countArgs.where.id.in).toHaveLength(1); // deduplicado
    });
  });

  // -------------------------------------------------------------------------
  // setMarkupGlobal
  // -------------------------------------------------------------------------

  describe('setMarkupGlobal', () => {
    it('atualiza markup de todos os itens do catálogo do user', async () => {
      prisma.repCatalogoItem.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.setMarkupGlobal(fakeUser(), { markup: 20 });

      expect(result).toEqual({ ok: true, atualizados: 5 });
      const args = prisma.repCatalogoItem.updateMany.mock.calls[0][0];
      expect(args.where.usuarioId).toBe('rep-1');
      expect(args.data.markup).toBe(20);
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.setMarkupGlobal(fakeUser({ empresaIdAtiva: null }), { markup: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // removeItem
  // -------------------------------------------------------------------------

  describe('removeItem', () => {
    it('remove item quando existe', async () => {
      prisma.repCatalogoItem.findUnique.mockResolvedValue({ id: 'cat-1' });
      prisma.repCatalogoItem.delete.mockResolvedValue({ id: 'cat-1' });

      await expect(service.removeItem(fakeUser(), 'p-1')).resolves.toBeUndefined();

      expect(prisma.repCatalogoItem.delete).toHaveBeenCalledWith({
        where: { usuarioId_produtoId: { usuarioId: 'rep-1', produtoId: 'p-1' } },
      });
    });

    it('lança NotFoundException quando item não existe no catálogo', async () => {
      prisma.repCatalogoItem.findUnique.mockResolvedValue(null);

      await expect(service.removeItem(fakeUser(), 'p-inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.repCatalogoItem.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('remove todos os itens do catálogo do usuário', async () => {
      prisma.repCatalogoItem.deleteMany.mockResolvedValue({ count: 7 });

      const result = await service.clear(fakeUser());

      expect(result).toEqual({ ok: true, removidos: 7 });
      const args = prisma.repCatalogoItem.deleteMany.mock.calls[0][0];
      expect(args.where.usuarioId).toBe('rep-1');
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.clear(fakeUser({ empresaIdAtiva: null })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // previewParaCliente
  // -------------------------------------------------------------------------

  describe('previewParaCliente', () => {
    it('retorna preview com preço final = precoTabela * (1 + markup/100)', async () => {
      const fakeCliente = { id: 'cli-1', nome: 'Cliente X' };
      clientes.findById.mockResolvedValue(fakeCliente);
      prisma.repCatalogoItem.findMany.mockResolvedValue([
        fakeCatalogoItem({ markup: 10, produto: { precoTabela: 50 } }),
      ]);
      pricing.priceForClientBatch.mockResolvedValue(new Map()); // sem preço negociado

      const result = await service.previewParaCliente(fakeUser(), 'cli-1');

      expect(result).toHaveLength(1);
      // 50 * 1.10 = 55
      expect(result[0].precoFinal).toBe(55);
      expect(result[0].precoNegociado).toBe(false);
    });

    it('usa preço negociado do cliente quando disponível', async () => {
      clientes.findById.mockResolvedValue({ id: 'cli-1' });
      prisma.repCatalogoItem.findMany.mockResolvedValue([
        fakeCatalogoItem({ markup: 10, produtoId: 'p-1', produto: { precoTabela: 50 } }),
      ]);
      pricing.priceForClientBatch.mockResolvedValue(
        new Map([['p-1', { precoFinal: 40, negociado: true, vigente: true }]]),
      );

      const result = await service.previewParaCliente(fakeUser(), 'cli-1');

      // 40 * 1.10 = 44
      expect(result[0].precoFinal).toBe(44);
      expect(result[0].precoNegociado).toBe(true);
    });

    it('retorna [] quando catálogo está vazio', async () => {
      clientes.findById.mockResolvedValue({ id: 'cli-1' });
      prisma.repCatalogoItem.findMany.mockResolvedValue([]);

      const result = await service.previewParaCliente(fakeUser(), 'cli-1');

      expect(result).toEqual([]);
      expect(pricing.priceForClientBatch).not.toHaveBeenCalled();
    });

    it('lança erro se clientes.findById lançar (cliente não encontrado)', async () => {
      clientes.findById.mockRejectedValue(new NotFoundException('Cliente', 'cli-nao-existe'));

      await expect(service.previewParaCliente(fakeUser(), 'cli-nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // shareWithClient
  // -------------------------------------------------------------------------

  describe('shareWithClient', () => {
    it('retorna url de compartilhamento quando catálogo tem itens', async () => {
      const fakeCliente = { id: 'cli-1', nome: 'Cliente X' };
      clientes.findById.mockResolvedValue(fakeCliente);
      // previewParaCliente precisa de listMyCatalog internamente
      prisma.repCatalogoItem.findMany.mockResolvedValue([fakeCatalogoItem()]);
      pricing.priceForClientBatch.mockResolvedValue(new Map());

      const result = await service.shareWithClient(fakeUser(), {
        clienteId: 'cli-1',
        canal: 'WHATSAPP',
      });

      expect(result.ok).toBe(true);
      expect(result.canal).toBe('WHATSAPP');
      expect(result.clienteId).toBe('cli-1');
      expect(result.itens).toBe(1);
      expect(result.previewUrl).toContain('rep-1');
      expect(result.previewUrl).toContain('cli-1');
    });

    it('lança BusinessRuleException quando catálogo está vazio', async () => {
      clientes.findById.mockResolvedValue({ id: 'cli-1' });
      prisma.repCatalogoItem.findMany.mockResolvedValue([]); // catálogo vazio

      await expect(
        service.shareWithClient(fakeUser(), { clienteId: 'cli-1', canal: 'WHATSAPP' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });
});
