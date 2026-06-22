import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MLOrdersService } from './ml-orders.service';
import type { MLOrder } from './ml.types';

const makeMLClientMock = () => ({ get: vi.fn() });

const makePrismaMock = () => ({
  marketplaceOrder: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
});

const fakeOrder = (overrides: Partial<MLOrder> = {}): MLOrder => ({
  id: 1,
  status: 'paid',
  total_amount: 250,
  currency_id: 'BRL',
  date_created: '2026-05-10T10:00:00Z',
  buyer: { id: 1, nickname: 'JOAOSILVA', first_name: 'João', last_name: 'Silva' },
  order_items: [
    { quantity: 2, item: { id: 'MLB1', title: 'Produto X' }, unit_price: 125, currency_id: 'BRL' },
    { quantity: 1, item: { id: 'MLB2', title: 'Produto Y' }, unit_price: 0, currency_id: 'BRL' },
  ],
  ...overrides,
});

describe('MLOrdersService', () => {
  let ml: ReturnType<typeof makeMLClientMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: MLOrdersService;

  beforeEach(() => {
    ml = makeMLClientMock();
    prisma = makePrismaMock();
    service = new MLOrdersService(ml as never, prisma as never);
  });

  describe('obter', () => {
    it('chama GET /orders/:id', async () => {
      ml.get.mockResolvedValue(fakeOrder());

      await service.obter('emp-1', 'order-1');

      expect(ml.get).toHaveBeenCalledWith('emp-1', '/orders/order-1');
    });
  });

  describe('listarRecentes', () => {
    it('passa seller e filtros padrão na URL', async () => {
      ml.get.mockResolvedValue({ results: [fakeOrder()] });

      const r = await service.listarRecentes('emp-1', 'seller-x');

      const url = ml.get.mock.calls[0][1];
      expect(url).toContain('seller=seller-x');
      expect(url).toContain('order.date_created.from=');
      expect(url).toContain('sort=date_desc');
      expect(r).toHaveLength(1);
    });

    it('aceita desdeIso customizado', async () => {
      ml.get.mockResolvedValue({ results: [] });

      await service.listarRecentes('emp-1', 'seller-x', '2026-01-01T00:00:00Z');

      const url = ml.get.mock.calls[0][1];
      expect(url).toContain('2026-01-01T00');
    });
  });

  describe('processarOrder', () => {
    it('insere quando pedido não existe', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);

      await service.processarOrder('emp-1', fakeOrder());

      expect(prisma.marketplaceOrder.create).toHaveBeenCalledOnce();
      const data = prisma.marketplaceOrder.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        empresaId: 'emp-1',
        plataforma: 'ML',
        numeroExterno: '1',
        status: 'paid',
        quantidade: 3, // 2 + 1
        valor: 250,
      });
    });

    it('atualiza quando pedido existe (preserva campos imutáveis)', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue({ id: 'mo-1' });

      await service.processarOrder('emp-1', fakeOrder({ status: 'shipped' }));

      expect(prisma.marketplaceOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mo-1' },
          data: expect.objectContaining({ status: 'shipped' }),
        }),
      );
      expect(prisma.marketplaceOrder.create).not.toHaveBeenCalled();
    });

    it('usa nickname quando first/last_name vazios', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);
      await service.processarOrder(
        'emp-1',
        fakeOrder({ buyer: { id: 1, nickname: 'NICK', first_name: '', last_name: '' } }),
      );

      const data = prisma.marketplaceOrder.create.mock.calls[0][0].data;
      expect(data.comprador).toBe('NICK');
    });
  });
});
