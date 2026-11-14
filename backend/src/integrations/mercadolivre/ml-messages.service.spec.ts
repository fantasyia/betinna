import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MLMessagesService, packDosRecursos } from './ml-messages.service';

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
    it('mensagem do seller entra como OUTBOUND (a conversa mostra os dois lados, 25/10)', async () => {
      ml.get.mockResolvedValue({
        messages: [
          fakeMessage({ id: 'm-1', from: { user_id: 999 } }), // do próprio seller
          fakeMessage({ id: 'm-2', from: { user_id: 555 } }), // do buyer
        ],
      });

      const r = await service.processarPack('emp-1', 'pack-1', 999);

      expect(r.processadas).toBe(2);
      const dirs = inbox.processarMensagemEntrante.mock.calls.map((c) => [
        c[0].externalId,
        c[0].direction,
      ]);
      expect(dirs).toEqual([
        ['m-1', 'OUTBOUND'],
        ['m-2', 'INBOUND'],
      ]);
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

  describe('listarMensagens — tag e paginação (14/11)', () => {
    it('manda tag=post_sale e pagina até o total', async () => {
      const lote = (n: number, base: number) =>
        Array.from({ length: n }, (_, i) => fakeMessage({ id: `m-${base + i}` }));
      ml.get
        .mockResolvedValueOnce({ paging: { total: 60 }, messages: lote(50, 0) })
        .mockResolvedValueOnce({ paging: { total: 60 }, messages: lote(10, 50) });

      const r = await service.listarMensagens('emp-1', '2000', '999');

      expect(r).toHaveLength(60);
      expect(ml.get.mock.calls[0][1]).toContain('tag=post_sale');
      expect(ml.get.mock.calls[0][1]).toContain('offset=0');
      expect(ml.get.mock.calls[1][1]).toContain('offset=50');
    });
  });

  describe('packDosRecursos', () => {
    it('prefere packs; sem pack usa o pedido; sem nada = null', () => {
      expect(
        packDosRecursos([
          { id: '111', name: 'orders' },
          { id: '222', name: 'packs' },
        ]),
      ).toBe('222');
      expect(packDosRecursos([{ id: 333, name: 'orders' }])).toBe('333');
      expect(packDosRecursos([])).toBeNull();
      expect(packDosRecursos(undefined)).toBeNull();
    });
  });

  describe('processarNotificacao (webhook messages)', () => {
    it('resource = ID da mensagem (hash): lê a mensagem, acha o pack e importa', async () => {
      ml.get
        .mockResolvedValueOnce({
          messages: [{ ...fakeMessage(), message_resources: [{ id: '2000123', name: 'packs' }] }],
        })
        .mockResolvedValueOnce({ paging: { total: 1 }, messages: [fakeMessage({ id: 'm-9' })] });

      const r = await service.processarNotificacao(
        'emp-1',
        '0ce04d2ff5b7489d916c87d0ac7a4bc3',
        '999',
      );

      expect(ml.get.mock.calls[0][1]).toBe(
        '/messages/0ce04d2ff5b7489d916c87d0ac7a4bc3?tag=post_sale',
      );
      expect(ml.get.mock.calls[1][1]).toContain('/messages/packs/2000123/sellers/999');
      expect(r).toEqual({ processadas: 1, packId: '2000123' });
      expect(inbox.processarMensagemEntrante.mock.calls[0][0].peerId).toBe('pack:2000123');
    });

    it('aceita a mensagem devolvida sem envelope e /messages/<id> no resource', async () => {
      ml.get
        .mockResolvedValueOnce({
          ...fakeMessage(),
          message_resources: [{ id: 77, name: 'orders' }],
        })
        .mockResolvedValueOnce({ messages: [] });

      const r = await service.processarNotificacao('emp-1', '/messages/abc123', 999);

      expect(r.packId).toBe('77');
    });

    it('resource com caminho de pack vai direto pro pack', async () => {
      ml.get.mockResolvedValueOnce({ messages: [fakeMessage()] });

      const r = await service.processarNotificacao('emp-1', '/messages/packs/55/sellers/999', 1);

      expect(ml.get).toHaveBeenCalledTimes(1);
      expect(ml.get.mock.calls[0][1]).toContain('/messages/packs/55/sellers/999');
      expect(r.packId).toBe('55');
    });

    it('mensagem sem pack nem pedido não importa nada', async () => {
      ml.get.mockResolvedValueOnce({ messages: [{ ...fakeMessage(), message_resources: [] }] });

      const r = await service.processarNotificacao('emp-1', 'abc', 999);

      expect(r).toEqual({ processadas: 0, packId: null });
      expect(inbox.processarMensagemEntrante).not.toHaveBeenCalled();
    });
  });

  describe('sincronizarRecentes (rede de segurança do cron)', () => {
    const agora = new Date('2026-11-14T12:00:00Z');

    it('junta packs não lidos + pedidos dos últimos 2 dias, sem repetir pack', async () => {
      ml.get.mockImplementation(async (_e: string, path: string) => {
        if (path.startsWith('/messages/unread')) {
          return {
            results: [
              { resource: '/packs/100/sellers/999', count: 2 },
              { resource: '/packs/200/sellers/999', count: 1 },
            ],
          };
        }
        return { messages: [fakeMessage({ id: `m-${path}` })] };
      });

      const r = await service.sincronizarRecentes(
        'emp-1',
        '999',
        [
          { id: 1, pack_id: 100, date_created: '2026-11-13T10:00:00Z' }, // repete o 100
          { id: 2, pack_id: null, date_created: '2026-11-14T08:00:00Z' }, // sem pack → id
          {
            id: 3,
            pack_id: 300,
            date_created: '2026-10-01T00:00:00Z',
            date_last_updated: '2026-11-14T01:00:00Z', // antigo, mas mexido agora
          },
          { id: 4, pack_id: 400, date_created: '2026-11-01T00:00:00Z' }, // fora da janela
        ],
        agora,
      );

      const packs = ml.get.mock.calls
        .map((c) => c[1] as string)
        .filter((p) => p.startsWith('/messages/packs/'))
        .map((p) => p.split('/')[3]);
      expect(packs.sort()).toEqual(['100', '2', '200', '300']);
      expect(r).toEqual({ packs: 4, mensagens: 4, falhas: 0 });
    });

    it('falha no /unread ou num pack não derruba o resto', async () => {
      ml.get.mockImplementation(async (_e: string, path: string) => {
        if (path.startsWith('/messages/unread')) throw new Error('HTTP 500');
        if (path.includes('/packs/1/')) throw new Error('HTTP 403');
        return { messages: [fakeMessage()] };
      });

      const r = await service.sincronizarRecentes(
        'emp-1',
        '999',
        [
          { id: 1, date_created: '2026-11-14T08:00:00Z' },
          { id: 2, date_created: '2026-11-14T08:00:00Z' },
        ],
        agora,
      );

      expect(r).toEqual({ packs: 2, mensagens: 1, falhas: 1 });
    });
  });
});
