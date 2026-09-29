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

  beforeEach(() => {
    ml = makeMLClientMock();
    inbox = makeInboxMock();
    service = new MLQuestionsService(ml as never, inbox as never);
  });

  describe('diagnosticoPendentes (29/09, só leitura)', () => {
    it('cruza a busca por seller com /my/received_questions e traz o status do anúncio + campos extras', async () => {
      ml.get
        .mockResolvedValueOnce({
          questions: [
            {
              ...fakeQuestion({ id: 1, item_id: 'MLB1' }),
              hold: false,
              deleted_from_listing: false,
            },
            { ...fakeQuestion({ id: 2, item_id: 'MLB2' }), hold: true },
          ],
        })
        .mockResolvedValueOnce({ questions: [fakeQuestion({ id: 1 })] })
        .mockResolvedValueOnce([
          { code: 200, body: { id: 'MLB1', status: 'paused' } },
          { code: 200, body: { id: 'MLB2', status: 'active' } },
        ]);

      const r = await service.diagnosticoPendentes('emp-1', '999');

      expect(r).toMatchObject({
        totalPorSeller: 2,
        totalMeusRecebidos: 1,
        erroMeusRecebidos: null,
      });
      expect(r.perguntas[0]).toMatchObject({
        id: 1,
        statusAnuncio: 'paused',
        emMeusRecebidos: true,
        extras: { hold: false, deleted_from_listing: false },
      });
      expect(r.perguntas[1]).toMatchObject({
        id: 2,
        emMeusRecebidos: false,
        extras: { hold: true },
      });
      // nada de texto do comprador nem credencial na saída
      expect(JSON.stringify(r)).not.toMatch(/Qual o prazo|token/i);
    });

    it('/my/received_questions falhando não derruba o diagnóstico', async () => {
      ml.get
        .mockResolvedValueOnce({ questions: [fakeQuestion()] })
        .mockRejectedValueOnce(new Error('403 forbidden'))
        .mockResolvedValueOnce([]);
      const r = await service.diagnosticoPendentes('emp-1', '999');
      expect(r.erroMeusRecebidos).toBe('403 forbidden');
      expect(r.totalPorSeller).toBe(1);
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
