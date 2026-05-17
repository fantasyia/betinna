import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AmazonOrdersService } from './amazon-orders.service';

const makeAmazonMock = () => ({
  get: vi.fn(),
  marketplaceId: 'A2Q3Y263D00KWC', // Brazil
});

const makePrismaMock = () => ({
  marketplaceOrder: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
});

const makeInboxMock = () => ({
  processarMensagemEntrante: vi.fn().mockResolvedValue({ conversationId: 'conv-1' }),
});

const fakeOrder = (overrides: Record<string, unknown> = {}) => ({
  AmazonOrderId: '123-4567890-1234567',
  OrderStatus: 'Unshipped',
  OrderTotal: { Amount: '199.99', CurrencyCode: 'BRL' },
  PurchaseDate: '2026-05-10T10:00:00Z',
  LastUpdateDate: '2026-05-12T11:00:00Z',
  MarketplaceId: 'A2Q3Y263D00KWC',
  BuyerInfo: { BuyerName: 'João Silva', BuyerEmail: 'joao@amzn.com' },
  ShippingAddress: { Name: 'João Silva' },
  ...overrides,
});

describe('AmazonOrdersService', () => {
  let amazon: ReturnType<typeof makeAmazonMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let service: AmazonOrdersService;

  beforeEach(() => {
    amazon = makeAmazonMock();
    prisma = makePrismaMock();
    inbox = makeInboxMock();
    service = new AmazonOrdersService(amazon as never, prisma as never, inbox as never);
  });

  describe('listarRecentes', () => {
    it('paginates with NextToken até esgotar', async () => {
      amazon.get
        .mockResolvedValueOnce({
          payload: { Orders: [fakeOrder({ AmazonOrderId: 'A' })], NextToken: 'next-1' },
        })
        .mockResolvedValueOnce({
          payload: { Orders: [fakeOrder({ AmazonOrderId: 'B' })], NextToken: undefined },
        });

      const r = await service.listarRecentes('emp-1');

      expect(r).toHaveLength(2);
      expect(amazon.get).toHaveBeenCalledTimes(2);
      // segunda chamada passa NextToken
      expect(amazon.get.mock.calls[1][2].NextToken).toBe('next-1');
    });

    it('inclui MarketplaceIds e LastUpdatedAfter no query', async () => {
      amazon.get.mockResolvedValue({ payload: { Orders: [] } });

      await service.listarRecentes('emp-1', 24);

      const params = amazon.get.mock.calls[0][2];
      expect(params.MarketplaceIds).toBe('A2Q3Y263D00KWC');
      expect(params.LastUpdatedAfter).toBeDefined();
    });
  });

  describe('obter / obterItens', () => {
    it('obter encoda AmazonOrderId na URL', async () => {
      amazon.get.mockResolvedValue({ payload: fakeOrder() });

      await service.obter('emp-1', '123-4567890-1234567');

      expect(amazon.get).toHaveBeenCalledWith('emp-1', '/orders/v0/orders/123-4567890-1234567');
    });

    it('obterItens retorna array vazio quando ausente', async () => {
      amazon.get.mockResolvedValue({ payload: {} });

      expect(await service.obterItens('emp-1', 'X')).toEqual([]);
    });
  });

  describe('processarOrder', () => {
    it('insere quando pedido novo + busca itens + cria Inbox SYSTEM', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);
      amazon.get.mockResolvedValue({
        payload: { OrderItems: [{ Title: 'Produto A', QuantityOrdered: 2 }] },
      });

      await service.processarOrder('emp-1', fakeOrder());

      const data = prisma.marketplaceOrder.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        empresaId: 'emp-1',
        plataforma: 'AMAZON',
        numeroExterno: '123-4567890-1234567',
        comprador: 'João Silva',
        produtoNome: 'Produto A',
        quantidade: 2,
        valor: 199.99,
      });
      // Inbox SYSTEM message
      const inboxArg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(inboxArg.peerId).toBe('order:123-4567890-1234567');
      expect(inboxArg.tipo).toBe('SYSTEM');
    });

    it('continua mesmo quando obterItens falha (best-effort)', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);
      amazon.get.mockRejectedValue(new Error('rate-limit'));

      await expect(service.processarOrder('emp-1', fakeOrder())).resolves.toBeUndefined();
      // Cria o pedido mesmo sem itens
      expect(prisma.marketplaceOrder.create).toHaveBeenCalled();
    });

    it('atualiza quando pedido já existe', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue({ id: 'mo-1' });
      amazon.get.mockResolvedValue({ payload: { OrderItems: [] } });

      await service.processarOrder('emp-1', fakeOrder({ OrderStatus: 'Shipped' }));

      expect(prisma.marketplaceOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mo-1' },
          data: expect.objectContaining({ status: 'Shipped' }),
        }),
      );
    });

    it('usa ShippingAddress.Name como fallback quando BuyerInfo.BuyerName ausente', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);
      amazon.get.mockResolvedValue({ payload: { OrderItems: [] } });

      await service.processarOrder(
        'emp-1',
        fakeOrder({ BuyerInfo: undefined, ShippingAddress: { Name: 'Maria' } }),
      );

      const data = prisma.marketplaceOrder.create.mock.calls[0][0].data;
      expect(data.comprador).toBe('Maria');
    });
  });
});
