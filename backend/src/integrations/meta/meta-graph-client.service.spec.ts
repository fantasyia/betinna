import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { MetaGraphClientService } from './meta-graph-client.service';

const makeHttpMock = () => ({ request: vi.fn() });

const makeEnvMock = () => ({
  get: vi.fn((k: string) => {
    const d: Record<string, string> = {
      META_GRAPH_API_VERSION: 'v19.0',
      META_GRAPH_APP_ID: 'app-id',
      META_GRAPH_APP_SECRET: 'app-secret',
    };
    return d[k] ?? '';
  }),
});

describe('MetaGraphClientService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let service: MetaGraphClientService;

  beforeEach(() => {
    http = makeHttpMock();
    service = new MetaGraphClientService(http as never, makeEnvMock() as never);
  });

  describe('oauthDialogUrl', () => {
    it('inclui versão configurada do Graph API', () => {
      expect(service.oauthDialogUrl).toBe('https://www.facebook.com/v19.0/dialog/oauth');
    });
  });

  describe('exchangeCode', () => {
    it('chama /oauth/access_token com client_id, client_secret, redirect_uri e code', async () => {
      http.request.mockResolvedValue({ data: { access_token: 'short-tok', token_type: 'bearer' } });

      const r = await service.exchangeCode('CODE_X', 'https://app.com/cb');

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('/oauth/access_token');
      expect(url).toContain('client_id=app-id');
      expect(url).toContain('client_secret=app-secret');
      expect(url).toContain('code=CODE_X');
      expect(r.access_token).toBe('short-tok');
    });

    it('lança IntegrationException quando response não tem access_token', async () => {
      http.request.mockResolvedValue({ data: {} });

      await expect(service.exchangeCode('X', 'Y')).rejects.toBeInstanceOf(IntegrationException);
    });
  });

  describe('exchangeLongLived', () => {
    it('chama /oauth/access_token com grant_type=fb_exchange_token', async () => {
      http.request.mockResolvedValue({ data: { access_token: 'long-tok' } });

      const r = await service.exchangeLongLived('short-tok');

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('grant_type=fb_exchange_token');
      expect(url).toContain('fb_exchange_token=short-tok');
      expect(r.access_token).toBe('long-tok');
    });
  });

  describe('listarPages', () => {
    it('chama /me/accounts e retorna pages do user', async () => {
      http.request.mockResolvedValue({
        data: { data: [{ id: 'p1', name: 'Page 1', access_token: 'page-tok' }] },
      });

      const r = await service.listarPages('user-tok');

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('/me/accounts');
      expect(url).toContain('access_token=user-tok');
      expect(r).toHaveLength(1);
    });

    it('retorna array vazio quando data ausente', async () => {
      http.request.mockResolvedValue({ data: {} });

      expect(await service.listarPages('t')).toEqual([]);
    });
  });

  describe('obterIgVinculadoPage', () => {
    it('retorna IG account quando page tem vínculo', async () => {
      http.request.mockResolvedValue({
        data: {
          instagram_business_account: { id: 'ig-1', username: 'ig_usr', name: 'IG' },
        },
      });

      const r = await service.obterIgVinculadoPage('page-1', 'page-tok');

      expect(r?.id).toBe('ig-1');
    });

    it('retorna null quando page não tem IG vinculado', async () => {
      http.request.mockResolvedValue({ data: {} });

      expect(await service.obterIgVinculadoPage('p', 't')).toBeNull();
    });
  });

  describe('enviarTexto', () => {
    it('POST /{senderEndpoint}/messages com recipient e messaging_type default RESPONSE', async () => {
      http.request.mockResolvedValue({ data: { message_id: 'mid-1' } });

      await service.enviarTexto({
        senderEndpointId: 'page-1',
        pageAccessToken: 'page-tok',
        recipientPsid: 'psid-9',
        texto: 'Olá',
      });

      const callArgs = http.request.mock.calls[0];
      expect(callArgs[0]).toBe('POST');
      expect(callArgs[1]).toContain('/page-1/messages');
      expect(callArgs[2].body).toMatchObject({
        recipient: { id: 'psid-9' },
        message: { text: 'Olá' },
        messaging_type: 'RESPONSE',
      });
    });

    it('inclui tag no body quando informado', async () => {
      http.request.mockResolvedValue({ data: { message_id: 'm' } });

      await service.enviarTexto({
        senderEndpointId: 'p',
        pageAccessToken: 't',
        recipientPsid: 'r',
        texto: 'X',
        messagingType: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT',
      });

      const body = http.request.mock.calls[0][2].body;
      expect(body.tag).toBe('HUMAN_AGENT');
      expect(body.messaging_type).toBe('MESSAGE_TAG');
    });

    it('encoda senderEndpointId na URL', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.enviarTexto({
        senderEndpointId: 'page id with space',
        pageAccessToken: 't',
        recipientPsid: 'r',
        texto: 'X',
      });

      expect(http.request.mock.calls[0][1]).toContain('page%20id%20with%20space');
    });
  });

  describe('tratamento de erros', () => {
    it('embrulha HttpClientError em IntegrationException', async () => {
      http.request.mockRejectedValue(new HttpClientError(400, { error: 'oops' }, 'u', 'GET', 1));

      await expect(service.listarPages('t')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('redacta access_token e client_secret nos logs', async () => {
      http.request.mockResolvedValue({ data: { data: [] } });

      await service.listarPages('t');

      const redact = http.request.mock.calls[0][2].redactKeys;
      expect(redact).toEqual(expect.arrayContaining(['access_token', 'client_secret']));
    });
  });
});
