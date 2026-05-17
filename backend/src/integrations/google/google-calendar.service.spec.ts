import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { GoogleCalendarService } from './google-calendar.service';

const makeHttpMock = () => ({
  request: vi.fn(),
  delete: vi.fn(),
});

const makeOAuthMock = () => ({
  getAccessToken: vi.fn().mockResolvedValue('access-tok-1'),
});

describe('GoogleCalendarService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let oauth: ReturnType<typeof makeOAuthMock>;
  let service: GoogleCalendarService;

  beforeEach(() => {
    http = makeHttpMock();
    oauth = makeOAuthMock();
    service = new GoogleCalendarService(http as never, oauth as never);
  });

  // -------------------------------------------------------------------------
  // criarEvento
  // -------------------------------------------------------------------------

  describe('criarEvento', () => {
    const baseParams = {
      titulo: 'Visita Cliente X',
      inicio: new Date('2026-06-01T10:00:00Z'),
      fim: new Date('2026-06-01T11:00:00Z'),
    };

    it('lança IntegrationException quando fim <= inicio', async () => {
      await expect(
        service.criarEvento('user-1', {
          titulo: 'X',
          inicio: new Date('2026-06-01T10:00:00Z'),
          fim: new Date('2026-06-01T10:00:00Z'),
        }),
      ).rejects.toBeInstanceOf(IntegrationException);
    });

    it('cria evento via POST com Bearer token + timezone padrão America/Sao_Paulo', async () => {
      http.request.mockResolvedValue({ data: { id: 'evt-1', summary: 'Visita' } });

      const result = await service.criarEvento('user-1', baseParams);

      expect(oauth.getAccessToken).toHaveBeenCalledWith('user-1');
      expect(http.request).toHaveBeenCalledWith(
        'POST',
        expect.stringContaining('/calendars/primary/events'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer access-tok-1' },
          body: expect.objectContaining({
            summary: 'Visita Cliente X',
            start: expect.objectContaining({ timeZone: 'America/Sao_Paulo' }),
            end: expect.objectContaining({ timeZone: 'America/Sao_Paulo' }),
          }),
        }),
      );
      expect(result.id).toBe('evt-1');
    });

    it('aceita timezone customizado', async () => {
      http.request.mockResolvedValue({ data: { id: 'evt-2' } });

      await service.criarEvento('user-1', { ...baseParams, timezone: 'UTC' });

      const body = http.request.mock.calls[0][2].body;
      expect(body.start.timeZone).toBe('UTC');
    });

    it('mapeia participantes para attendees do Google', async () => {
      http.request.mockResolvedValue({ data: { id: 'evt-3' } });

      await service.criarEvento('user-1', {
        ...baseParams,
        participantes: [{ email: 'a@x.com', nome: 'Ana' }],
      });

      const body = http.request.mock.calls[0][2].body;
      expect(body.attendees).toEqual([{ email: 'a@x.com', displayName: 'Ana' }]);
    });

    it('embrulha HttpClientError em IntegrationException', async () => {
      http.request.mockRejectedValue(
        new HttpClientError(403, { error: 'insufficient_scope' }, 'https://x', 'POST', 1),
      );

      await expect(service.criarEvento('user-1', baseParams)).rejects.toBeInstanceOf(
        IntegrationException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // atualizarEvento
  // -------------------------------------------------------------------------

  describe('atualizarEvento', () => {
    it('envia PATCH apenas com campos definidos', async () => {
      http.request.mockResolvedValue({ data: { id: 'evt-1', summary: 'Novo' } });

      await service.atualizarEvento('user-1', 'evt-1', { titulo: 'Novo' });

      const callArgs = http.request.mock.calls[0];
      expect(callArgs[0]).toBe('PATCH');
      expect(callArgs[1]).toContain('/events/evt-1');
      expect(callArgs[2].body).toEqual({ summary: 'Novo' });
    });

    it('encoda o eventId na URL', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.atualizarEvento('user-1', 'evt with spaces', {});

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('evt%20with%20spaces');
    });

    it('inclui start/end quando inicio/fim são fornecidos', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.atualizarEvento('user-1', 'evt-1', {
        inicio: new Date('2026-06-10T14:00:00Z'),
        fim: new Date('2026-06-10T15:00:00Z'),
      });

      const body = http.request.mock.calls[0][2].body;
      expect(body.start).toBeDefined();
      expect(body.end).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // deletarEvento
  // -------------------------------------------------------------------------

  describe('deletarEvento', () => {
    it('chama DELETE com Bearer token', async () => {
      http.delete.mockResolvedValue({ data: null });

      await service.deletarEvento('user-1', 'evt-99');

      expect(http.delete).toHaveBeenCalledWith(
        expect.stringContaining('/events/evt-99'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer access-tok-1' },
        }),
      );
    });

    it('considera 404 idempotente (não lança)', async () => {
      http.delete.mockRejectedValue(new HttpClientError(404, {}, 'https://x', 'DELETE', 1));

      await expect(service.deletarEvento('user-1', 'evt-99')).resolves.toBeUndefined();
    });

    it('considera 410 idempotente (não lança)', async () => {
      http.delete.mockRejectedValue(new HttpClientError(410, {}, 'https://x', 'DELETE', 1));

      await expect(service.deletarEvento('user-1', 'evt-99')).resolves.toBeUndefined();
    });

    it('embrulha erro 500 em IntegrationException', async () => {
      http.delete.mockRejectedValue(new HttpClientError(500, {}, 'https://x', 'DELETE', 1));

      await expect(service.deletarEvento('user-1', 'evt-99')).rejects.toBeInstanceOf(
        IntegrationException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // listarEventos
  // -------------------------------------------------------------------------

  describe('listarEventos', () => {
    it('retorna lista de eventos', async () => {
      http.request.mockResolvedValue({
        data: { items: [{ id: 'evt-1' }, { id: 'evt-2' }] },
      });

      const result = await service.listarEventos(
        'user-1',
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );

      expect(result).toHaveLength(2);
    });

    it('retorna array vazio quando items ausente', async () => {
      http.request.mockResolvedValue({ data: {} });

      const result = await service.listarEventos(
        'user-1',
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );

      expect(result).toEqual([]);
    });

    it('passa timeMin, timeMax, singleEvents e orderBy na URL', async () => {
      http.request.mockResolvedValue({ data: { items: [] } });

      await service.listarEventos(
        'user-1',
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-31T00:00:00Z'),
        25,
      );

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('timeMin=');
      expect(url).toContain('timeMax=');
      expect(url).toContain('singleEvents=true');
      expect(url).toContain('orderBy=startTime');
      expect(url).toContain('maxResults=25');
    });
  });
});
