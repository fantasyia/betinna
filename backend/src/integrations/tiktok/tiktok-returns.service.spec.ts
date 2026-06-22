import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TikTokReturnsService } from './tiktok-returns.service';

const makeTikTokMock = () => ({
  post: vi.fn().mockResolvedValue({ data: { return_records: [] } }),
});

const makeEnvMock = () => ({
  get: vi.fn((k: string) => (k === 'TIKTOK_API_VERSION' ? '202309' : '')),
});

const makeInboxMock = () => ({
  processarMensagemEntrante: vi.fn().mockResolvedValue({ conversationId: 'conv-1' }),
});

const makeIncidentsMock = () => ({
  registrarIncidente: vi.fn().mockResolvedValue({ id: 'inc-1' }),
});

const fakeReturn = (overrides: Record<string, unknown> = {}) => ({
  return_id: 'tt-rt-1',
  order_id: 'tt-ord-1',
  status: 'RETURN_OR_REFUND_REQUEST_PENDING',
  return_type: 'REFUND_ONLY',
  return_reason: 'WRONG_ITEM',
  return_reason_text: 'Veio errado',
  refund_amount: { amount: '50.00', currency: 'BRL' },
  create_time: 1715759000,
  update_time: 1715759400,
  seller_proposal_deadline: 1716364200,
  ...overrides,
});

describe('TikTokReturnsService', () => {
  let tiktok: ReturnType<typeof makeTikTokMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let incidents: ReturnType<typeof makeIncidentsMock>;
  let service: TikTokReturnsService;

  beforeEach(() => {
    tiktok = makeTikTokMock();
    inbox = makeInboxMock();
    incidents = makeIncidentsMock();
    service = new TikTokReturnsService(
      tiktok as never,
      makeEnvMock() as never,
      inbox as never,
      incidents as never,
    );
  });

  describe('listar / obter', () => {
    it('listar usa endpoint search com api_version', async () => {
      tiktok.post.mockResolvedValue({ data: { return_records: [fakeReturn()] } });

      const r = await service.listar('emp-1');

      expect(tiktok.post.mock.calls[0][1]).toContain('/return_refund/202309/returns/search');
      expect(r).toHaveLength(1);
    });

    it('obter retorna primeiro record do response', async () => {
      tiktok.post.mockResolvedValue({ data: { return_records: [fakeReturn()] } });

      const r = await service.obter('emp-1', 'tt-rt-1');

      expect(r?.return_id).toBe('tt-rt-1');
    });

    it('obter retorna null quando não encontrado', async () => {
      tiktok.post.mockResolvedValue({ data: { return_records: [] } });

      expect(await service.obter('emp-1', 'inexistente')).toBeNull();
    });
  });

  describe('ações estruturadas', () => {
    it('aceitar chama seller_proposal com decision=AGREE', async () => {
      await service.aceitar('emp-1', 'tt-rt-1');

      const call = tiktok.post.mock.calls[0];
      expect(call[1]).toContain('/returns/tt-rt-1/seller_proposal');
      expect(call[2]).toMatchObject({ decision: 'AGREE' });
    });

    it('rejeitar chama seller_reject com motivo', async () => {
      await service.rejeitar('emp-1', 'tt-rt-1', 'evidence shows correct delivery');

      const call = tiktok.post.mock.calls[0];
      expect(call[1]).toContain('/returns/tt-rt-1/seller_reject');
      expect(call[2]).toMatchObject({ reject_reason: 'evidence shows correct delivery' });
    });

    it('anexarEvidencia chama seller_evidence com images', async () => {
      await service.anexarEvidencia('emp-1', 'tt-rt-1', ['url1', 'url2']);

      const call = tiktok.post.mock.calls[0];
      expect(call[1]).toContain('/returns/tt-rt-1/seller_evidence');
      expect(call[2]).toMatchObject({ images: ['url1', 'url2'] });
    });
  });

  describe('processarReturn — mapping de status', () => {
    it('RETURN_OR_REFUND_REQUEST_PENDING → AGUARDANDO_VENDEDOR', async () => {
      await service.processarReturn('emp-1', fakeReturn());

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('AGUARDANDO_VENDEDOR');
    });

    it('IN_ARBITRATION → EM_MEDIACAO + tipo MEDIACAO', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'IN_ARBITRATION' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('EM_MEDIACAO');
      expect(incidentArg.tipo).toBe('MEDIACAO');
    });

    it('REFUND_SUCCESS → RESOLVIDO', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'REFUND_SUCCESS' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('RESOLVIDO');
    });

    it('REFUND_FAIL → AGUARDANDO_VENDEDOR (não é resolvido — exige nossa ação)', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'REFUND_FAIL' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('AGUARDANDO_VENDEDOR');
      expect(incidentArg.status).not.toBe('RESOLVIDO');
    });

    it('BUYER_CANCEL_REQUEST → CANCELADO', async () => {
      await service.processarReturn('emp-1', fakeReturn({ status: 'BUYER_CANCEL_REQUEST' }));

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.status).toBe('CANCELADO');
    });

    it('cria Inbox SYSTEM message com peerId return:<id>', async () => {
      await service.processarReturn('emp-1', fakeReturn());

      const inboxArg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(inboxArg.peerId).toBe('return:tt-rt-1');
      expect(inboxArg.tipo).toBe('SYSTEM');
    });

    it('vincula incident à conversationId da Inbox', async () => {
      await service.processarReturn('emp-1', fakeReturn());

      const incidentArg = incidents.registrarIncidente.mock.calls[0][0];
      expect(incidentArg.conversationId).toBe('conv-1');
    });
  });
});
