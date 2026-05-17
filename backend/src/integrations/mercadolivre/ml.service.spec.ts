import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { MLService } from './ml.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePrismaMock = () => ({
  conversation: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
});

const makeClientMock = () => ({
  getCredenciais: vi.fn(),
});

const makeQuestionsMock = () => ({
  responder: vi.fn().mockResolvedValue({ externalId: 'a:123' }),
});

const makeMessagesMock = () => ({
  enviarMensagem: vi.fn().mockResolvedValue({ externalId: 'msg-1' }),
});

const makeClaimsMock = () => ({
  enviarMensagem: vi.fn().mockResolvedValue({ externalId: 'cm-1' }),
});

const makeRegistryMock = () => ({
  registrar: vi.fn(),
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MLService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let client: ReturnType<typeof makeClientMock>;
  let questions: ReturnType<typeof makeQuestionsMock>;
  let messages: ReturnType<typeof makeMessagesMock>;
  let claims: ReturnType<typeof makeClaimsMock>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let service: MLService;

  beforeEach(() => {
    prisma = makePrismaMock();
    client = makeClientMock();
    questions = makeQuestionsMock();
    messages = makeMessagesMock();
    claims = makeClaimsMock();
    registry = makeRegistryMock();
    service = new MLService(
      registry as never,
      prisma as never,
      client as never,
      questions as never,
      messages as never,
      claims as never,
    );
  });

  // -------------------------------------------------------------------------
  // onModuleInit
  // -------------------------------------------------------------------------

  describe('onModuleInit', () => {
    it('registra-se na CanalAdapterRegistry', () => {
      service.onModuleInit();
      expect(registry.registrar).toHaveBeenCalledWith(service);
    });
  });

  // -------------------------------------------------------------------------
  // canal
  // -------------------------------------------------------------------------

  describe('canal', () => {
    it('expõe canal = MARKETPLACE_ML', () => {
      expect(service.canal).toBe('MARKETPLACE_ML');
    });
  });

  // -------------------------------------------------------------------------
  // estaDisponivel
  // -------------------------------------------------------------------------

  describe('estaDisponivel', () => {
    it('retorna true quando credenciais existem', async () => {
      client.getCredenciais.mockResolvedValue({ accessToken: 'tok' });

      expect(await service.estaDisponivel('emp-1')).toBe(true);
    });

    it('retorna false quando credenciais lançam', async () => {
      client.getCredenciais.mockRejectedValue(new Error('not configured'));

      expect(await service.estaDisponivel('emp-1')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // enviarTexto — roteamento por prefixo
  // -------------------------------------------------------------------------

  describe('enviarTexto', () => {
    it('roteia q:<id> → MLQuestionsService.responder', async () => {
      const result = await service.enviarTexto('emp-1', 'q:9876', 'Olá!');

      expect(questions.responder).toHaveBeenCalledWith('emp-1', '9876', 'Olá!');
      expect(messages.enviarMensagem).not.toHaveBeenCalled();
      expect(claims.enviarMensagem).not.toHaveBeenCalled();
      expect(result.externalId).toBe('a:123');
    });

    it('roteia claim:<id> → MLClaimsService.enviarMensagem', async () => {
      const result = await service.enviarTexto('emp-1', 'claim:555', 'Resposta');

      expect(claims.enviarMensagem).toHaveBeenCalledWith('emp-1', '555', 'Resposta');
      expect(questions.responder).not.toHaveBeenCalled();
      expect(result.externalId).toBe('cm-1');
    });

    it('roteia pack:<id> com seller+buyer no metadata → MLMessagesService', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        categoria: 'POS_VENDA',
        metadata: { ml_seller_id: 'seller-1', ml_buyer_id: 'buyer-9' },
      });

      await service.enviarTexto('emp-1', 'pack:42', 'Texto');

      expect(messages.enviarMensagem).toHaveBeenCalledWith(
        'emp-1',
        '42',
        'seller-1',
        'buyer-9',
        'Texto',
      );
    });

    it('pack:<id> sem buyer_id no metadata lança BusinessRuleException', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        categoria: 'POS_VENDA',
        metadata: { ml_seller_id: 'seller-1' }, // buyer_id ausente
      });
      client.getCredenciais.mockResolvedValue({ userId: 'fallback-seller' });

      await expect(service.enviarTexto('emp-1', 'pack:42', 'Texto')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('rejeita peerId com formato desconhecido', async () => {
      await expect(service.enviarTexto('emp-1', 'random:abc', 'X')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('busca Conversation com proprietarioId=null (ML é escopo empresa)', async () => {
      await service.enviarTexto('emp-1', 'q:9', 'X');

      const whereArg = prisma.conversation.findFirst.mock.calls[0][0].where;
      expect(whereArg.proprietarioId).toBeNull();
    });
  });
});
