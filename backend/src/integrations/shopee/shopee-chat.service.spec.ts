import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ShopeeChatService } from './shopee-chat.service';

const makeShopeeMock = () => ({
  getShop: vi.fn(),
  postShop: vi.fn(),
  getCredenciais: vi.fn().mockResolvedValue({ shopId: '111' }),
});

const makeInboxMock = () => ({
  processarMensagemEntrante: vi.fn().mockResolvedValue({ conversationId: 'conv-1' }),
});

const fakeMessage = (overrides: Record<string, unknown> = {}) => ({
  message_id: 'msg-1',
  from_id: 222, // buyer
  from_shop_id: 0,
  to_id: 111, // seller shop
  message_type: 'text',
  content: { text: 'Olá vendedor' },
  created_timestamp: 1715759400,
  source: 'sdk',
  ...overrides,
});

describe('ShopeeChatService', () => {
  let shopee: ReturnType<typeof makeShopeeMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let service: ShopeeChatService;

  beforeEach(() => {
    shopee = makeShopeeMock();
    inbox = makeInboxMock();
    service = new ShopeeChatService(shopee as never, inbox as never);
  });

  describe('listarMensagens', () => {
    it('chama getShop com path correto e conversation_id', async () => {
      shopee.getShop.mockResolvedValue({ response: { messages: [fakeMessage()] } });

      const r = await service.listarMensagens('emp-1', 'conv-abc', 30);

      expect(shopee.getShop).toHaveBeenCalledWith(
        'emp-1',
        '/api/v2/sellerchat/get_message',
        expect.objectContaining({ conversation_id: 'conv-abc', page_size: 30 }),
      );
      expect(r).toHaveLength(1);
    });
  });

  describe('processarConversation', () => {
    it('ignora mensagens enviadas pelo próprio shop (from_shop_id = shopId)', async () => {
      shopee.getShop.mockResolvedValue({
        response: {
          messages: [
            fakeMessage({ message_id: 'm-mine', from_shop_id: 111 }), // nossa
            fakeMessage({ message_id: 'm-buyer', from_shop_id: 0 }), // buyer
          ],
        },
      });

      const r = await service.processarConversation('emp-1', 'conv-abc');

      expect(r.processadas).toBe(1);
      expect(inbox.processarMensagemEntrante).toHaveBeenCalledOnce();
    });

    it('cria Inbox message com peerId conv:<id> e categoria POS_VENDA', async () => {
      shopee.getShop.mockResolvedValue({ response: { messages: [fakeMessage()] } });

      await service.processarConversation('emp-1', 'conv-abc');

      const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(arg.peerId).toBe('conv:conv-abc');
      expect(arg.tipo).toBe('TEXT');
      expect(arg.conteudo).toBe('Olá vendedor');
      expect(arg.meta).toMatchObject({
        categoria: 'POS_VENDA',
        shopee_from_id: 222,
      });
    });

    it('mapeia tipo=image com placeholder e mediaUrl', async () => {
      shopee.getShop.mockResolvedValue({
        response: {
          messages: [
            fakeMessage({
              message_type: 'image',
              content: { url: 'https://shopee.x/img.jpg' },
            }),
          ],
        },
      });

      await service.processarConversation('emp-1', 'conv-abc');

      const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(arg.tipo).toBe('IMAGE');
      expect(arg.conteudo).toBe('[imagem]');
      expect(arg.mediaUrl).toBe('https://shopee.x/img.jpg');
    });

    it('mapeia tipo=order como CONTACT com order_sn no texto', async () => {
      shopee.getShop.mockResolvedValue({
        response: {
          messages: [
            fakeMessage({ message_type: 'order', content: { order_sn: 'ORD-X' } }),
          ],
        },
      });

      await service.processarConversation('emp-1', 'conv-abc');

      const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(arg.tipo).toBe('CONTACT');
      expect(arg.conteudo).toContain('ORD-X');
    });

    it('ignora mensagem de texto vazia', async () => {
      shopee.getShop.mockResolvedValue({
        response: {
          messages: [fakeMessage({ content: { text: '' } })],
        },
      });

      const r = await service.processarConversation('emp-1', 'conv-abc');

      expect(r.processadas).toBe(0);
      expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
    });
  });

  describe('enviarMensagem', () => {
    it('POST sellerchat/send_message com to_id, content e conversation_id', async () => {
      shopee.postShop.mockResolvedValue({ response: { message_id: 'sent-1' } });

      const r = await service.enviarMensagem('emp-1', 'conv-x', 222, 'Olá!');

      expect(shopee.postShop).toHaveBeenCalledWith(
        'emp-1',
        '/api/v2/sellerchat/send_message',
        expect.objectContaining({
          to_id: 222,
          message_type: 'text',
          content: { text: 'Olá!' },
          conversation_id: 'conv-x',
        }),
      );
      expect(r.externalId).toBe('sent-1');
    });
  });
});
