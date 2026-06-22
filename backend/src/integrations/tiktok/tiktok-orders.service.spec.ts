import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TikTokOrdersService } from './tiktok-orders.service';

const makeTikTokMock = () => ({ post: vi.fn() });

const makeEnvMock = () => ({
  get: vi.fn((k: string) => (k === 'TIKTOK_API_VERSION' ? '202309' : '')),
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
  id: 'tt-1',
  status: 'AWAITING_SHIPMENT',
  payment: { currency: 'BRL', total_amount: '99.90' },
  create_time: 1715759400,
  update_time: 1715759500,
  line_items: [
    { id: 'li-1', product_name: 'Produto A' },
    { id: 'li-2', product_name: 'Produto B' },
  ],
  recipient_address: { name: 'João' },
  buyer_uid: 'buyer-x',
  buyer_email: 'comprador@tt.com',
  ...overrides,
});

describe('TikTokOrdersService', () => {
  let tiktok: ReturnType<typeof makeTikTokMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let service: TikTokOrdersService;

  beforeEach(() => {
    tiktok = makeTikTokMock();
    prisma = makePrismaMock();
    inbox = makeInboxMock();
    service = new TikTokOrdersService(
      tiktok as never,
      makeEnvMock() as never,
      prisma as never,
      inbox as never,
    );
  });

  describe('listarRecentes', () => {
    it('chama POST /order/202309/orders/search com janela de tempo', async () => {
      tiktok.post.mockResolvedValue({ data: { orders: [{ id: 'A' }] } });

      const r = await service.listarRecentes('emp-1');

      const path = tiktok.post.mock.calls[0][1];
      expect(path).toContain('/order/202309/orders/search');
      expect(r).toEqual(['A']);
    });

    it('respeita dias=7 default (update_time_ge ~ 604800s antes)', async () => {
      tiktok.post.mockResolvedValue({ data: { orders: [] } });

      await service.listarRecentes('emp-1', 7);

      const body = tiktok.post.mock.calls[0][2];
      const delta = body.update_time_lt - body.update_time_ge;
      expect(delta).toBe(7 * 24 * 60 * 60);
    });
  });

  describe('obterDetalhes', () => {
    it('retorna array vazio quando orderIds vazio sem chamar API', async () => {
      expect(await service.obterDetalhes('emp-1', [])).toEqual([]);
      expect(tiktok.post).not.toHaveBeenCalled();
    });

    it('faz chunks de 50 ids quando há mais', async () => {
      const ids = Array.from({ length: 75 }, (_, i) => `id-${i}`);
      tiktok.post.mockResolvedValue({ data: { orders: [] } });

      await service.obterDetalhes('emp-1', ids);

      // 75 ids → 2 chamadas (50 + 25)
      expect(tiktok.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('processarOrder', () => {
    it('insere quando pedido novo + cria Inbox SYSTEM message', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);

      await service.processarOrder('emp-1', fakeOrder());

      const data = prisma.marketplaceOrder.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        empresaId: 'emp-1',
        plataforma: 'TIKTOK',
        numeroExterno: 'tt-1',
        quantidade: 2,
        valor: 99.9,
      });
      // Inbox message com peerId order:<id>
      const inboxArg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(inboxArg.peerId).toBe('order:tt-1');
      expect(inboxArg.tipo).toBe('SYSTEM');
    });

    it('atualiza quando pedido existe', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue({ id: 'mo-1' });

      await service.processarOrder('emp-1', fakeOrder({ status: 'SHIPPED' }));

      expect(prisma.marketplaceOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mo-1' },
          data: expect.objectContaining({ status: 'SHIPPED' }),
        }),
      );
    });

    it('comprador = recipient.name (fallback buyer_uid)', async () => {
      prisma.marketplaceOrder.findUnique.mockResolvedValue(null);

      await service.processarOrder(
        'emp-1',
        fakeOrder({ recipient_address: undefined, buyer_uid: 'uid-9' }),
      );

      const data = prisma.marketplaceOrder.create.mock.calls[0][0].data;
      expect(data.comprador).toBe('uid-9');
    });
  });
});
