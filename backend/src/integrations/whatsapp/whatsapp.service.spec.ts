import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { WhatsAppService } from './whatsapp.service';

const makeSessionsMock = () => ({
  estaConectado: vi.fn().mockReturnValue(true),
  enviarTexto: vi.fn().mockResolvedValue({ externalId: 'wa-msg-1' }),
});

const makeRegistryMock = () => ({ registrar: vi.fn() });

describe('WhatsAppService', () => {
  let sessions: ReturnType<typeof makeSessionsMock>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let service: WhatsAppService;

  beforeEach(() => {
    sessions = makeSessionsMock();
    registry = makeRegistryMock();
    service = new WhatsAppService(sessions as never, registry as never);
  });

  describe('canal e onModuleInit', () => {
    it('expõe canal = WHATSAPP', () => {
      expect(service.canal).toBe('WHATSAPP');
    });

    it('registra no init', () => {
      service.onModuleInit();
      expect(registry.registrar).toHaveBeenCalledWith(service);
    });
  });

  describe('enviarTexto — roteamento dual-owner', () => {
    it('sem ctx.proprietarioId → usa sessão EMPRESA', async () => {
      await service.enviarTexto('emp-1', '5511@s.whatsapp.net', 'Oi');

      expect(sessions.enviarTexto).toHaveBeenCalledWith(
        { type: 'EMPRESA', id: 'emp-1' },
        '5511@s.whatsapp.net',
        'Oi',
      );
    });

    it('com ctx.proprietarioId → usa sessão USUARIO desse rep', async () => {
      await service.enviarTexto('emp-1', '5511@s.whatsapp.net', 'Oi', {
        proprietarioId: 'rep-9',
      });

      expect(sessions.enviarTexto).toHaveBeenCalledWith(
        { type: 'USUARIO', id: 'rep-9' },
        '5511@s.whatsapp.net',
        'Oi',
      );
    });

    it('lança BusinessRuleException quando sessão EMPRESA não conectada', async () => {
      sessions.estaConectado.mockReturnValue(false);

      await expect(service.enviarTexto('emp-1', 'x', 'Oi')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(sessions.enviarTexto).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException com msg específica quando sessão USUARIO não conectada', async () => {
      sessions.estaConectado.mockReturnValue(false);

      await expect(
        service.enviarTexto('emp-1', 'x', 'Oi', { proprietarioId: 'rep-9' }),
      ).rejects.toThrowError(/pessoal/);
    });
  });

  describe('estaDisponivel', () => {
    it('checa sessão EMPRESA quando sem proprietarioId', async () => {
      sessions.estaConectado.mockReturnValue(true);

      expect(await service.estaDisponivel('emp-1')).toBe(true);
      expect(sessions.estaConectado).toHaveBeenCalledWith({ type: 'EMPRESA', id: 'emp-1' });
    });

    it('checa sessão USUARIO quando há proprietarioId', async () => {
      sessions.estaConectado.mockReturnValue(true);

      await service.estaDisponivel('emp-1', 'rep-9');

      expect(sessions.estaConectado).toHaveBeenCalledWith({ type: 'USUARIO', id: 'rep-9' });
    });
  });
});
