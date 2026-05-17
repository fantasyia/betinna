import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShopeeReturnsService } from './shopee-returns.service';

const makeShopeeMock = () => ({
  getShop: vi.fn(),
  postShop: vi.fn(),
});

const makeInboxMock = () => ({
  processarMensagemEntrante: vi.fn().mockResolvedValue({ conversationId: 'conv-1' }),
});

const makeIncidentsMock = () => ({
  registrarIncidente: vi.fn().mockResolvedValue({ id: 'inc-1' }),
});

const fakeReturn = (overrides: Record<string, unknown> = {}) => ({
  return_sn: 'RT-1',
  order_sn: 'ORD-1',
  status: 'REQUESTED',
  reason: 'NOT_RECEIVED',
  text_reason: 'Não recebi',
  refund_amount: 99.9,
  update_time: 1715759400,
  due_date: 1716364200,
  user: { username: 'comprador1' },
  ...overrides,
});

describe('ShopeeReturnsService', () => {
  let shopee: ReturnType<typeof makeShopeeMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let incidents: ReturnType<typeof makeIncidentsMock>;
  let service: ShopeeReturnsService;

  beforeEach(() => {
    shopee = makeShopeeMock();
    inbox = makeInboxMock();
    incidents = makeIncidentsMock();
    service = new ShopeeReturnsService(shopee as never, inbox as never, incidents as never);
  });

  describe('obter / listar', () => {
    it('obter chama get_return_detail', async () => {
      shopee.getShop.mockResolvedValue({ response: fakeReturn() });

      await service.obter('emp-1', 'RT-1');

      expect(shopee.getShop).toHaveBeenCalledWith(
        'emp-1',
        '/api/v2/returns/get_return_detail',
        expect.objectContaining({ return_sn: 'RT-1' }),
      );
    });

    it('listar retorna array vazio quando ausente', async () => {
      shopee.getShop.mockResolvedValue({ response: {} });

      expect(await service.listar('emp-1')).toEqual([]);
    });
  });

  describe('processarReturn — mapping de status/tipo', () => {
    it('REQUESTED → AGUARDANDO_VENDEDOR + tipo DEVOLUCAO', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'REQUESTED' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('AGUARDANDO_VENDEDOR');
      expect(incidentArg.tipo).toBe('DEVOLUCAO');
    });

    it('JUDGING → EM_MEDIACAO + tipo MEDIACAO', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'JUDGING' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('EM_MEDIACAO');
      expect(incidentArg.tipo).toBe('MEDIACAO');
    });

    it('SELLER_DISPUTE → EM_MEDIACAO + tipo DISPUTA', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'SELLER_DISPUTE' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.tipo).toBe('DISPUTA');
    });

    it('REFUND_PAID → RESOLVIDO', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'REFUND_PAID' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('RESOLVIDO');
    });

    it('CANCELLED → CANCELADO', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'CANCELLED' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('CANCELADO');
    });

    it('cria Inbox SYSTEM message com peerId return:<sn>', async () => {
      await service.processarReturn('emp-1', fakeReturn());

      const inboxArg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(inboxArg.peerId).toBe('return:RT-1');
      expect(inboxArg.tipo).toBe('SYSTEM');
    });

    it('vincula incident à conversationId retornada pela Inbox', async () => {
      await service.processarReturn('emp-1', fakeReturn());

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.conversationId).toBe('conv-1');
    });
  });

  describe('ações estruturadas (escala/aceita)', () => {
    it('abrirDisputa chama POST /returns/dispute', async () => {
      await service.abrirDisputa('emp-1', 'RT-1', 'Produto correto enviado');

      expect(shopee.postShop).toHaveBeenCalledWith(
        'emp-1',
        '/api/v2/returns/dispute',
        expect.objectContaining({ return_sn: 'RT-1', dispute_reason: 'Produto correto enviado' }),
      );
    });

    it('aceitarOferta chama POST /returns/accept_offer', async () => {
      await service.aceitarOferta('emp-1', 'RT-1');

      expect(shopee.postShop).toHaveBeenCalledWith('emp-1', '/api/v2/returns/accept_offer', {
        return_sn: 'RT-1',
      });
    });
  });
});
