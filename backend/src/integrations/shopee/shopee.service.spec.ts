import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { ShopeeService } from './shopee.service';

const makePrismaMock = () => ({
  conversation: { findFirst: vi.fn().mockResolvedValue(null) },
});

const makeClientMock = () => ({ getCredenciais: vi.fn() });
const makeChatMock = () => ({ enviarMensagem: vi.fn().mockResolvedValue({ externalId: 'cm-1' }) });
const makeRegistryMock = () => ({ registrar: vi.fn() });

describe('ShopeeService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let client: ReturnType<typeof makeClientMock>;
  let chat: ReturnType<typeof makeChatMock>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let service: ShopeeService;

  beforeEach(() => {
    prisma = makePrismaMock();
    client = makeClientMock();
    chat = makeChatMock();
    registry = makeRegistryMock();
    service = new ShopeeService(registry as never, prisma as never, client as never, chat as never);
  });

  describe('canal e onModuleInit', () => {
    it('expõe canal = MARKETPLACE_SHOPEE', () => {
      expect(service.canal).toBe('MARKETPLACE_SHOPEE');
    });

    it('registra na CanalAdapterRegistry no init', () => {
      service.onModuleInit();
      expect(registry.registrar).toHaveBeenCalledWith(service);
    });
  });

  describe('estaDisponivel', () => {
    it('true quando credenciais resolvem', async () => {
      client.getCredenciais.mockResolvedValue({});
      expect(await service.estaDisponivel('emp-1')).toBe(true);
    });

    it('false quando credenciais lançam', async () => {
      client.getCredenciais.mockRejectedValue(new Error('off'));
      expect(await service.estaDisponivel('emp-1')).toBe(false);
    });
  });

  describe('enviarTexto', () => {
    it('roteia conv:<id> com buyer_id metadata → ShopeeChatService', async () => {
      prisma.conversation.findFirst.mockResolvedValue({
        metadata: { shopee_from_id: 'buyer-42' },
      });

      await service.enviarTexto('emp-1', 'conv:abc', 'Olá');

      expect(chat.enviarMensagem).toHaveBeenCalledWith('emp-1', 'abc', 'buyer-42', 'Olá');
    });

    it('conv:<id> sem buyer_id no metadata lança BusinessRuleException', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ metadata: {} });

      await expect(service.enviarTexto('emp-1', 'conv:abc', 'X')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('return:<id> sempre rejeita (API não suporta chat livre)', async () => {
      await expect(service.enviarTexto('emp-1', 'return:rt-1', 'X')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('rejeita peerId com formato desconhecido', async () => {
      await expect(service.enviarTexto('emp-1', 'foo:bar', 'X')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });
});
