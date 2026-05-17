import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MLQuestionsService } from './ml-questions.service';

const makeMLClientMock = () => ({
  get: vi.fn(),
  post: vi.fn(),
});

const makeInboxMock = () => ({
  processarMensagemEntrante: vi.fn().mockResolvedValue({ conversationId: 'conv-1' }),
});

const fakeQuestion = (overrides: Record<string, unknown> = {}) => ({
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

  beforeEach(() => {
    ml = makeMLClientMock();
    inbox = makeInboxMock();
    service = new MLQuestionsService(ml as never, inbox as never);
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

      expect(ml.get).toHaveBeenCalledWith(
        'emp-1',
        expect.stringContaining('/questions/search?'),
      );
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
