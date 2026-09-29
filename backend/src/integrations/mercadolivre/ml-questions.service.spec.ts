import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MLQuestionsService } from './ml-questions.service';
import type { MLQuestion } from './ml.types';

const makeMLClientMock = () => ({
  get: vi.fn(),
  post: vi.fn(),
});

const makeInboxMock = () => ({
  processarMensagemEntrante: vi.fn().mockResolvedValue({ conversationId: 'conv-1' }),
});

const fakeQuestion = (overrides: Partial<MLQuestion> = {}): MLQuestion => ({
  id: 1234,
  text: 'Qual o prazo?',
  status: 'UNANSWERED',
  date_created: '2026-05-15T10:00:00Z',
  item_id: 'MLB123',
  seller_id: 999,
  from: { id: 555 },
  ...overrides,
});

describe('MLQuestionsService', () => {
  let ml: ReturnType<typeof makeMLClientMock>;
  let inbox: ReturnType<typeof makeInboxMock>;
  let service: MLQuestionsService;
  let prisma: { conversation: { updateMany: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    ml = makeMLClientMock();
    inbox = makeInboxMock();
    prisma = { conversation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    service = new MLQuestionsService(ml as never, inbox as never, prisma as never);
  });

  /** Léo, 29/09: a conta LGHB trouxe 18 "não respondidas"; o painel do ML mostra 3. */
  describe('sincronizarPendentes — só pergunta de anúncio ativo', () => {
    const q = (id: number, item: string) => fakeQuestion({ id, item_id: item });
    const busca = (questions: MLQuestion[]) => ({ questions });
    const itens = (pares: Array<[string, string]>) =>
      pares.map(([id, status]) => ({ code: 200, body: { id, status } }));

    it('importa as de anúncio ativo e arquiva as de pausado/encerrado', async () => {
      ml.get
        .mockResolvedValueOnce(busca([q(1, 'MLB1'), q(2, 'MLB2'), q(3, 'MLB3'), q(4, 'MLB1')]))
        .mockResolvedValueOnce(
          itens([
            ['MLB1', 'active'],
            ['MLB2', 'paused'],
            ['MLB3', 'closed'],
          ]),
        );

      const r = await service.sincronizarPendentes('emp-1', '999');

      expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(2);
      expect(inbox.processarMensagemEntrante.mock.calls.map((c) => c[0].peerId)).toEqual([
        'q:1',
        'q:4',
      ]);
      expect(prisma.conversation.updateMany.mock.calls.map((c) => c[0].where.peerId)).toEqual([
        'q:2',
        'q:3',
      ]);
      expect(prisma.conversation.updateMany.mock.calls[0][0].data.status).toBe('ARQUIVADA');
      expect(r).toMatchObject({
        importadas: 2,
        arquivadas: 2,
        porStatus: { active: 2, paused: 1, closed: 1 },
      });
      // o multiget pede cada anúncio uma vez só
      expect(ml.get.mock.calls[1][1]).toBe('/items?ids=MLB1,MLB2,MLB3&attributes=id,status');
    });

    it('status indisponível: importa todas (não esconde pergunta por falha de consulta)', async () => {
      ml.get
        .mockResolvedValueOnce(busca([q(1, 'MLB1'), q(2, 'MLB2')]))
        .mockRejectedValueOnce(new Error('503'));
      const r = await service.sincronizarPendentes('emp-1', '999');
      expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(2);
      expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
      expect(r.importadas).toBe(2);
    });

    it('anúncio que o ML não devolveu: importa', async () => {
      ml.get.mockResolvedValueOnce(busca([q(1, 'MLB9')])).mockResolvedValueOnce([{ code: 404 }]);
      await service.sincronizarPendentes('emp-1', '999');
      expect(inbox.processarMensagemEntrante).toHaveBeenCalledTimes(1);
    });

    it('consulta de status em lotes de 20', async () => {
      const muitas = Array.from({ length: 25 }, (_, i) => q(i + 1, `MLB${i + 1}`));
      ml.get.mockResolvedValueOnce(busca(muitas)).mockResolvedValue([]);
      await service.sincronizarPendentes('emp-1', '999');
      const lotes = ml.get.mock.calls
        .slice(1)
        .map((c) => String(c[1]).split('ids=')[1].split('&')[0].split(',').length);
      expect(lotes).toEqual([20, 5]);
    });
  });

  describe('obter', () => {
    it('chama GET /questions/:id', async () => {
      ml.get.mockResolvedValue(fakeQuestion());

      await service.obter('emp-1', 1234);

      expect(ml.get).toHaveBeenCalledWith('emp-1', '/questions/1234');
    });
  });

  describe('processarQuestion', () => {
    it('cria mensagem entrante na Inbox com peerId q:<id>', async () => {
      await service.processarQuestion('emp-1', fakeQuestion());

      expect(inbox.processarMensagemEntrante).toHaveBeenCalledWith(
        expect.objectContaining({
          empresaId: 'emp-1',
          canal: 'MARKETPLACE_ML',
          peerId: 'q:1234',
          tipo: 'TEXT',
          conteudo: 'Qual o prazo?',
          externalId: 'q:1234',
        }),
      );
    });

    it('inclui metadata categoria=PRE_VENDA e ids ML', async () => {
      await service.processarQuestion('emp-1', fakeQuestion());

      const arg = inbox.processarMensagemEntrante.mock.calls[0][0];
      expect(arg.meta).toMatchObject({
        ml_question_id: 1234,
        ml_item_id: 'MLB123',
        ml_seller_id: 999,
        ml_buyer_id: 555,
        categoria: 'PRE_VENDA',
        ml_origem: 'question',
      });
    });
  });

  describe('responder', () => {
    it('chama POST /answers com question_id e text', async () => {
      ml.post.mockResolvedValue({ id: 9876 });

      const r = await service.responder('emp-1', 1234, 'Prazo 7 dias');

      expect(ml.post).toHaveBeenCalledWith('emp-1', '/answers', {
        question_id: 1234,
        text: 'Prazo 7 dias',
      });
      expect(r.externalId).toBe('a:9876');
    });
  });

  describe('listarNaoRespondidas', () => {
    it('chama GET /questions/search com seller_id e status=UNANSWERED', async () => {
      ml.get.mockResolvedValue({ questions: [fakeQuestion()] });

      const r = await service.listarNaoRespondidas('emp-1', 'seller-x', 25);

      expect(ml.get).toHaveBeenCalledWith('emp-1', expect.stringContaining('/questions/search?'));
      const url = ml.get.mock.calls[0][1];
      expect(url).toContain('seller_id=seller-x');
      expect(url).toContain('status=UNANSWERED');
      expect(url).toContain('limit=25');
      expect(r).toHaveLength(1);
    });

    it('retorna array vazio quando ML retorna sem questions', async () => {
      ml.get.mockResolvedValue({});

      const r = await service.listarNaoRespondidas('emp-1', 'seller-x');

      expect(r).toEqual([]);
    });
  });
});
