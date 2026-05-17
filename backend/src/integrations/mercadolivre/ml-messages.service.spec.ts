import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MLMessagesService } from './ml-messages.service';

const makeMLClientMock = () => ({
  get: vi.fn(),
  post: vi.fn(),
});

const makeInboxMock = () => ({
  processarMensagemEntrante: vi.fn().mockResolvedValue({ conversationId: 'conv-1' }),
});

const fakeMessage = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  from: { user_id: 555 }, // buyer
  to: { user_id: 999 },
  text: { plain: 'Recebi o produto!' },
  message_date: { created: '2026-05-15T10:00:00Z', received: '2026-05-15T10:00:05Z' },
  status: 'available',
  message_attachments: undefined,
  ...overrides,
});

describe('MLMessagesService', () => {
  let ml: ReturnType<typeof makeMLClientMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let service: MLMessagesService;

  beforeEach(() => {
    ml = makeMLClientMock();
    inbox = makeInboxMock();
    service = new MLMessagesService(ml as never, inbox as never);
  });

  describe('listarMensagens', () => {
    it('chama endpoint correto de packs/sellers', async () => {
      ml.get.mockResolvedValue({ messages: [fakeMessage()] });

      const r = await service.listarMensagens('emp-1', 'pack-1', '999');

      expect(ml.get).toHaveBeenCalledWith(
        'emp-1',
        expect.stringContaining('/messages/packs/pack-1/sellers/999'),
      );
      expect(r).toHaveLength(1);
    });

    it('retorna array vazio quando ML retorna sem messages', async () => {
      ml.get.mockResolvedValue({});

      expect(await service.listarMensagens('emp-1', 'p', 's')).toEqual([]);
    });
  });

  describe('processarPack', () => {
    it('ignora mensagens enviadas pelo seller (echoes próprios)', async () => {
      ml.get.mockResolvedValue({
        messages: [
          fakeMessage({ id: 'm-1', from: { user_id: 999 } }), // do próprio seller
          fakeMessage({ id: 'm-2', from: { user_id: 555 } }), // do buyer
        ],
      });

      const r = await service.processarPack('emp-1', 'pack-1', 999);

      expect(r.processadas).toBe(1);
      expect(inbox.processarMensagemEntrante).toHaveBeenCalledOnce();
    });

    it('cria Inbox message com peerId pack:<id> e categoria POS_VENDA', async () => {
      ml.get.mockResolvedValue({ messages: [fakeMessage()] });

      await service.processarPack('emp-1', 'pack-1', 999);

      const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(arg).toMatchObject({
        peerId: 'pack:pack-1',
        canal: 'MARKETPLACE_ML',
        externalId: 'msg-1',
        conteudo: 'Recebi o produto!',
      });
      expect(arg.meta).toMatchObject({ categoria: 'POS_VENDA', ml_seller_id: 999 });
    });

    it('classifica mensagem com attachments como DOCUMENT', async () => {
      ml.get.mockResolvedValue({
        messages: [fakeMessage({ message_attachments: [{ url: 'foo' }] })],
      });

      await service.processarPack('emp-1', 'pack-1', 999);

      const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(arg.tipo).toBe('DOCUMENT');
    });
  });

  describe('enviarMensagem', () => {
    it('POST messages/packs/X/sellers/Y com tag post_sale + from/to/text', async () => {
      ml.post.mockResolvedValue({ id: 'sent-1' });

      const r = await service.enviarMensagem('emp-1', 'pack-x', 999, 555, 'Olá');

      expect(ml.post).toHaveBeenCalledWith(
        'emp-1',
        expect.stringContaining('/messages/packs/pack-x/sellers/999?tag=post_sale'),
        expect.objectContaining({
          from: { user_id: 999 },
          to: { user_id: 555 },
          text: { plain: 'Olá' },
        }),
      );
      expect(r.externalId).toBe('sent-1');
    });
  });
});
