import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { CatalogoService, type PreviewItem } from './catalogo.service';

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
  usuario: {
    findUnique: vi.fn(),
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
    service = new CatalogoService(
      prisma as never,
      clientes as never,
      pricing as never,
      {
        gerar: vi.fn().mockResolvedValue('fake.jwt.token'),
        validar: vi.fn().mockResolvedValue({
          repId: 'rep-1',
          clienteId: 'cli-1',
          empresaId: 'emp-1',
        }),
      } as never,
    );
  });

  // -------------------------------------------------------------------------
  // listMyCatalog
  // -------------------------------------------------------------------------

  describe('listMyCatalog', () => {
    it('retorna itens do catálogo (preço da MSM, sem markup)', async () => {
      prisma.repCatalogoItem.findMany.mockResolvedValue([fakeCatalogoItem()]);

      const result = await service.listMyCatalog(fakeUser());

      expect(result).toHaveLength(1);
      expect(result[0].produtoId).toBe('p-1');
      expect(result[0].produto.precoTabela).toBe(50);
      // markup foi removido do catálogo do rep — não vaza no retorno
      expect(result[0]).not.toHaveProperty('markup');
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
    it('vincula produto ao catálogo (sem markup — preço é o da MSM)', async () => {
      prisma.produto.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.repCatalogoItem.upsert.mockResolvedValue(fakeCatalogoItem());

      const result = await service.upsertItem(fakeUser(), { produtoId: 'p-1' });

      expect(result).not.toHaveProperty('markup');
      const args = prisma.repCatalogoItem.upsert.mock.calls[0][0];
      expect(args.where).toEqual({
        usuarioId_produtoId: { usuarioId: 'rep-1', produtoId: 'p-1' },
      });
      // create não passa markup (default 0 no schema); update é idempotente (vazio)
      expect(args.create).toEqual({ usuarioId: 'rep-1', produtoId: 'p-1' });
      expect(args.update).toEqual({});
    });

    it('lança BusinessRuleException se produto não pertence à empresa ou está inativo', async () => {
      prisma.produto.findFirst.mockResolvedValue(null);

      await expect(
        service.upsertItem(fakeUser(), { produtoId: 'p-inexistente' }),
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
        itens: [{ produtoId: 'p-1' }, { produtoId: 'p-2' }],
      });

      expect(result).toEqual({ ok: true, processados: 2 });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('lança BusinessRuleException se algum produto não pertence à empresa', async () => {
      prisma.produto.count.mockResolvedValue(1); // pediu 2, achou 1

      await expect(
        service.bulkUpsert(fakeUser(), {
          itens: [{ produtoId: 'p-1' }, { produtoId: 'p-outro-tenant' }],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deduplica produtoIds ao validar (Set)', async () => {
      prisma.produto.count.mockResolvedValue(1); // 1 único produto
      prisma.$transaction.mockResolvedValue([]);

      await service.bulkUpsert(fakeUser(), {
        itens: [
          { produtoId: 'p-1' },
          { produtoId: 'p-1' }, // duplicado
        ],
      });

      const countArgs = prisma.produto.count.mock.calls[0][0];
      expect(countArgs.where.id.in).toHaveLength(1); // deduplicado
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
      await expect(service.clear(fakeUser({ empresaIdAtiva: null }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // previewParaCliente
  // -------------------------------------------------------------------------

  describe('previewParaCliente', () => {
    it('preço final = tabela da MSM quando não há negociado (sem markup)', async () => {
      const fakeCliente = { id: 'cli-1', nome: 'Cliente X' };
      clientes.findById.mockResolvedValue(fakeCliente);
      prisma.repCatalogoItem.findMany.mockResolvedValue([
        fakeCatalogoItem({ produto: { precoTabela: 50 } }),
      ]);
      pricing.priceForClientBatch.mockResolvedValue(new Map()); // sem preço negociado

      const result = await service.previewParaCliente(fakeUser(), 'cli-1');

      expect(result).toHaveLength(1);
      // tabela MSM = 50, sem markup
      expect(result[0].precoFinal).toBe(50);
      expect(result[0].precoNegociado).toBe(false);
    });

    it('usa preço negociado do cliente quando disponível (sem markup por cima)', async () => {
      clientes.findById.mockResolvedValue({ id: 'cli-1' });
      prisma.repCatalogoItem.findMany.mockResolvedValue([
        fakeCatalogoItem({ produtoId: 'p-1', produto: { precoTabela: 50 } }),
      ]);
      pricing.priceForClientBatch.mockResolvedValue(
        new Map([['p-1', { precoFinal: 40, negociado: true, vigente: true }]]),
      );

      const result = await service.previewParaCliente(fakeUser(), 'cli-1');

      // negociado = 40, sem markup
      expect(result[0].precoFinal).toBe(40);
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
        canal: 'whatsapp',
      });

      expect(result.ok).toBe(true);
      expect(result.canal).toBe('whatsapp');
      expect(result.clienteId).toBe('cli-1');
      expect(result.itens).toBe(1);
      // Agora previewUrl é `/catalogo/share/<token>` (JWT) em vez de
      // ids brutos. Verifica que tem token e o resultado inclui o campo.
      expect(result.previewUrl).toMatch(/^\/catalogo\/share\/.+/);
      expect(result.token).toBe('fake.jwt.token');
    });

    it('lança BusinessRuleException quando catálogo está vazio', async () => {
      clientes.findById.mockResolvedValue({ id: 'cli-1' });
      prisma.repCatalogoItem.findMany.mockResolvedValue([]); // catálogo vazio

      await expect(
        service.shareWithClient(fakeUser(), { clienteId: 'cli-1', canal: 'whatsapp' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('share livre sem clienteId — gera link público sem vínculo (C4)', async () => {
      // Sem cliente: NÃO chama clientes.findById, usa previewSemCliente
      prisma.repCatalogoItem.findMany.mockResolvedValue([fakeCatalogoItem()]);

      const result = await service.shareWithClient(fakeUser(), { canal: 'whatsapp' } as never);

      expect(result.ok).toBe(true);
      expect(result.clienteId).toBeNull(); // sem vínculo
      expect(result.itens).toBe(1);
      expect(result.previewUrl).toMatch(/^\/catalogo\/share\/.+/);
      // Não deve ter tentado buscar cliente
      expect(clientes.findById).not.toHaveBeenCalled();
      // Não deve ter chamado pricing (não há cliente alvo)
      expect(pricing.priceForClientBatch).not.toHaveBeenCalled();
    });

    it('share livre — lança BusinessRuleException se catálogo vazio mesmo sem cliente', async () => {
      prisma.repCatalogoItem.findMany.mockResolvedValue([]);

      await expect(
        service.shareWithClient(fakeUser(), { canal: 'whatsapp' } as never),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // -------------------------------------------------------------------------
  // resolverShareToken — endpoint @Public() (visto pelo cliente final) — #6
  // -------------------------------------------------------------------------

  describe('resolverShareToken — não-vazamento público (#6)', () => {
    /** PreviewItem cru COM os campos sensíveis (como previewParaCliente devolve). */
    const previewSensivel = (): PreviewItem => ({
      id: 'cat-1',
      produtoId: 'p-1',
      produto: {
        id: 'p-1',
        nome: 'Óleo 5L',
        sku: 'OLE-5L',
        marca: 'Soya',
        linha: 'Alimentos',
        unidade: 'UN',
        imagem: null,
        precoTabela: 50,
        precoFabrica: 40, // CUSTO — não pode vazar
        popularidade: 5,
        ativo: true,
        estoque: 300, // não pode vazar
        estoqueAtualizadoEm: new Date('2026-07-01'),
      },
      precoFinal: 48,
      precoNegociado: true,
    });

    it('NÃO expõe precoFabrica, estoque, popularidade nem flags internas ao cliente', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 'rep-1',
        nome: 'Rep Teste',
        status: 'ATIVO',
        role: 'REP',
      });
      // validar (default) devolve clienteId → caminho previewParaCliente; espionamos.
      vi.spyOn(service, 'previewParaCliente').mockResolvedValue([previewSensivel()]);

      const out = await service.resolverShareToken('token-valido');

      expect(out.produtos).toHaveLength(1);
      const prod = out.produtos[0].produto as unknown as Record<string, unknown>;
      expect(prod).not.toHaveProperty('precoFabrica');
      expect(prod).not.toHaveProperty('estoque');
      expect(prod).not.toHaveProperty('estoqueAtualizadoEm');
      expect(prod).not.toHaveProperty('popularidade');
      expect(prod).not.toHaveProperty('ativo');
      // Campos públicos preservados:
      expect(prod).toMatchObject({ id: 'p-1', nome: 'Óleo 5L', sku: 'OLE-5L', precoTabela: 50 });
      expect(out.produtos[0].precoFinal).toBe(48);
      expect(out.produtos[0].precoNegociado).toBe(true);
      // id interno do RepCatalogoItem não é exposto — só produtoId.
      expect(out.produtos[0]).not.toHaveProperty('id');
      expect(out.produtos[0].produtoId).toBe('p-1');
    });

    it('rejeita link de rep inativo', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        id: 'rep-1',
        nome: 'X',
        status: 'INATIVO',
        role: 'REP',
      });
      await expect(service.resolverShareToken('token')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });
});
