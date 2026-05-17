import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FacebookService } from './facebook.service';

const makeGraphMock = () => ({
  enviarTexto: vi.fn().mockResolvedValue({ message_id: 'mid:fb-123' }),
});

const makeIntegracoesMock = () => ({
  obterCredenciaisInternas: vi.fn(),
});

const makeRegistryMock = () => ({ registrar: vi.fn() });

describe('FacebookService', () => {
  let graph: ReturnType<typeof makeGraphMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let service: FacebookService;

  beforeEach(() => {
    graph = makeGraphMock();
    integracoes = makeIntegracoesMock();
    registry = makeRegistryMock();
    service = new FacebookService(graph as never, integracoes as never, registry as never);
  });

  describe('canal e onModuleInit', () => {
    it('expõe canal = FACEBOOK', () => {
      expect(service.canal).toBe('FACEBOOK');
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
        credenciais: { pageId: 'page-1', pageAccessToken: 'EAA...' },
      });
    });

    it('envia mensagem via Graph com Page Access Token e messagingType RESPONSE', async () => {
      const result = await service.enviarTexto('emp-1', 'psid-9', 'Olá');

      expect(graph.enviarTexto).toHaveBeenCalledWith(
        expect.objectContaining({
          senderEndpointId: 'page-1',
          pageAccessToken: 'EAA...',
          recipientPsid: 'psid-9',
          texto: 'Olá',
          messagingType: 'RESPONSE',
        }),
      );
      expect(result.externalId).toBe('mid:fb-123');
    });

    it('propaga erro quando Graph falha', async () => {
      graph.enviarTexto.mockRejectedValue(new Error('token expired'));

      await expect(service.enviarTexto('emp-1', 'psid', 'X')).rejects.toThrow('token expired');
    });
  });
});
