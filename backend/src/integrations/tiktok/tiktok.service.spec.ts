import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { TikTokService } from './tiktok.service';

const makeClientMock = () => ({ getCredenciais: vi.fn() });
const makeRegistryMock = () => ({ registrar: vi.fn() });

describe('TikTokService', () => {
  let client: ReturnType<typeof makeClientMock>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let service: TikTokService;

  beforeEach(() => {
    client = makeClientMock();
    registry = makeRegistryMock();
    service = new TikTokService(registry as never, client as never);
  });

  describe('canal e onModuleInit', () => {
    it('expõe canal = MARKETPLACE_TIKTOK', () => {
      expect(service.canal).toBe('MARKETPLACE_TIKTOK');
    });

    it('registra na CanalAdapterRegistry', () => {
      service.onModuleInit();
      expect(registry.registrar).toHaveBeenCalledWith(service);
    });
  });

  describe('estaDisponivel', () => {
    it('true quando credenciais existem', async () => {
      client.getCredenciais.mockResolvedValue({});
      expect(await service.estaDisponivel('emp-1')).toBe(true);
    });

    it('false quando credenciais lançam', async () => {
      client.getCredenciais.mockRejectedValue(new Error('off'));
      expect(await service.estaDisponivel('emp-1')).toBe(false);
    });
  });

  describe('enviarTexto', () => {
    it('SEMPRE rejeita (TikTok Shop não expõe chat livre via API)', async () => {
      await expect(service.enviarTexto()).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });
});
