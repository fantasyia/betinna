import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InstagramService } from './instagram.service';

const makeGraphMock = () => ({
  enviarTexto: vi.fn().mockResolvedValue({ message_id: 'mid:ig-123' }),
});

const makeIntegracoesMock = () => ({
  obterCredenciaisInternas: vi.fn(),
});

const makeRegistryMock = () => ({ registrar: vi.fn() });

describe('InstagramService', () => {
  let graph: ReturnType<typeof makeGraphMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let service: InstagramService;

  beforeEach(() => {
    graph = makeGraphMock();
    integracoes = makeIntegracoesMock();
    registry = makeRegistryMock();
    service = new InstagramService(graph as never, integracoes as never, registry as never);
  });

  describe('canal e onModuleInit', () => {
    it('expõe canal = INSTAGRAM', () => {
      expect(service.canal).toBe('INSTAGRAM');
    });

    it('registra no init', () => {
      service.onModuleInit();
      expect(registry.registrar).toHaveBeenCalledWith(service);
    });
  });

  describe('estaDisponivel', () => {
    it('true quando integração ativa', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        ativo: true,
        credenciais: {},
      });
      expect(await service.estaDisponivel('emp-1')).toBe(true);
    });

    it('false quando integração inativa', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        ativo: false,
        credenciais: {},
      });
      expect(await service.estaDisponivel('emp-1')).toBe(false);
    });

    it('false quando credenciais lançam', async () => {
      integracoes.obterCredenciaisInternas.mockRejectedValue(new Error('not found'));
      expect(await service.estaDisponivel('emp-1')).toBe(false);
    });
  });

  describe('enviarTexto', () => {
    beforeEach(() => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        ativo: true,
        credenciais: { igUserId: 'ig-user-1', pageAccessToken: 'EAA...' },
      });
    });

    it('envia via Graph usando igUserId como senderEndpoint', async () => {
      const result = await service.enviarTexto('emp-1', 'ig-psid-9', 'Oi');

      expect(graph.enviarTexto).toHaveBeenCalledWith(
        expect.objectContaining({
          senderEndpointId: 'ig-user-1',
          pageAccessToken: 'EAA...',
          recipientPsid: 'ig-psid-9',
          texto: 'Oi',
          messagingType: 'RESPONSE',
        }),
      );
      expect(result.externalId).toBe('mid:ig-123');
    });
  });
});
