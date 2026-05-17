import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { AmazonService } from './amazon.service';

const makeClientMock = () => ({ getCredenciais: vi.fn() });
const makeMessagingMock = () => ({
  enviarTextoLivre: vi.fn().mockResolvedValue({ acaoUsada: 'confirmDeliveryDetails' }),
});
const makeRegistryMock = () => ({ registrar: vi.fn() });

describe('AmazonService', () => {
  let client: ReturnType<typeof makeClientMock>;
  let messaging: ReturnType<typeof makeMessagingMock>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let service: AmazonService;

  beforeEach(() => {
    client = makeClientMock();
    messaging = makeMessagingMock();
    registry = makeRegistryMock();
    service = new AmazonService(registry as never, client as never, messaging as never);
  });

  describe('canal e onModuleInit', () => {
    it('expõe canal = MARKETPLACE_AMAZON', () => {
      expect(service.canal).toBe('MARKETPLACE_AMAZON');
    });

    it('registra na CanalAdapterRegistry', () => {
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
    it('roteia order:<id> → AmazonMessagingService.enviarTextoLivre', async () => {
      const result = await service.enviarTexto(
        'emp-1',
        'order:123-456789-7654321',
        'Texto longo o suficiente.',
      );

      expect(messaging.enviarTextoLivre).toHaveBeenCalledWith(
        'emp-1',
        '123-456789-7654321',
        'Texto longo o suficiente.',
      );
      // externalId vem em formato acaoUsada:orderId:ts
      expect(result.externalId).toMatch(/^confirmDeliveryDetails:123-456789-7654321:\d+$/);
    });

    it('rejeita peerId sem prefixo order:', async () => {
      await expect(service.enviarTexto('emp-1', 'foo:bar', 'X qualquer')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('rejeita texto com menos de 5 chars (Amazon recusa textos triviais)', async () => {
      await expect(service.enviarTexto('emp-1', 'order:123', 'ok')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(messaging.enviarTextoLivre).not.toHaveBeenCalled();
    });

    it('rejeita texto que vira <5 chars após trim', async () => {
      await expect(service.enviarTexto('emp-1', 'order:123', '   ok   ')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });
});
