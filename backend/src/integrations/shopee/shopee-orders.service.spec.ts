import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShopeeOrdersService } from './shopee-orders.service';

const makeShopeeMock = () => ({ getShop: vi.fn() });

const makePrismaMock = () => ({
  marketplaceOrder: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
});

const fakeOrder = (overrides: Record<string, unknown> = {}) => ({
  order_sn: 'ORD-1',
  order_status: 'READY_TO_SHIP',
  buyer_username: 'comprador123',
  total_amount: 199.9,
  create_time: 1715759400,
  update_time: 1715762400,
  item_list: [
    {
      item_id: 101,
      item_name: 'Caneca',
      model_quantity_purchased: 2,
      model_original_price: 59.9,
      model_discounted_price: 49.9,
    },
    {
      item_id: 102,
      item_name: 'Chaveiro',
      model_quantity_purchased: 1,
      model_original_price: 19.9,
      model_discounted_price: 14.9,
    },
  ],
  ...overrides,
});

describe('ShopeeOrdersService', () => {
  let shopee: ReturnType<typeof makeShopeeMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ShopeeOrdersService;

  beforeEach(() => {
    shopee = makeShopeeMock();
    prisma = makePrismaMock();
    service = new ShopeeOrdersService(shopee as never, prisma as never);
  });

  describe('listarRecentes', () => {
    it('retorna array de order_sn', async () => {
      shopee.getShop.mockResolvedValue({
        response: {
          order_list: [{ order_sn: 'A' }, { order_sn: 'B' }],
        },
      });

      const r = await service.listarRecentes('emp-1');

      expect(r).toEqual(['A', 'B']);
    });

    it('passa time_from = now - dias e time_range_field=create_time', async () => {
      shopee.getShop.mockResolvedValue({ response: { order_list: [] } });

      await service.listarRecentes('emp-1', 7);

      const args = shopee.getShop.mock.calls[0][2];
      expect(args.time_range_field).toBe('create_time');
      expect(args.time_to).toBeGreaterThan(args.time_from);
      // Diferença ~ 7 dias = 604800
      expect(args.time_to - args.time_from).toBe(7 * 24 * 60 * 60);
    });
  });

  describe('obterDetalhes', () => {
    it('retorna array vazio quando orderSns vazio sem chamar API', async () => {
      const r = await service.obterDetalhes('emp-1', []);

      expect(r).toEqual([]);
      expect(shopee.getShop).not.toHaveBeenCalled();
    });

    it('passa order_sn_list como CSV', async () => {
      shopee.getShop.mockResolvedValue({ response: { order_list: [fakeOrder()] } });

      await service.obterDetalhes('emp-1', ['A', 'B', 'C']);

      const args = shopee.getShop.mock.calls[0][2];
      expect(args.order_sn_list).toBe('A,B,C');
    });
  });

  describe('processarOrder', () => {
    it('insere quando pedido novo', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);

      await service.processarOrder('emp-1', fakeOrder());

      const data = prisma.marketplaceOrder.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        empresaId: 'emp-1',
        plataforma: 'SHOPEE',
        numeroExterno: 'ORD-1',
        quantidade: 3,
        valor: 199.9,
        status: 'READY_TO_SHIP',
      });
    });

    it('atualiza quando pedido existe', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue({ id: 'mo-1' });

      await service.processarOrder('emp-1', fakeOrder({ order_status: 'SHIPPED' }));

      expect(prisma.marketplaceOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mo-1' },
          data: expect.objectContaining({ status: 'SHIPPED' }),
        }),
      );
    });
  });
});
