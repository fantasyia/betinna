import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { ShopeeClientService } from './shopee-client.service';

const makeHttpMock = () => ({ request: vi.fn() });

const makeEnvMock = () => ({
  get: vi.fn((k: string) => {
    const d: Record<string, string> = {
      SHOPEE_PARTNER_ID: '1234567',
      SHOPEE_PARTNER_KEY: 'partner-key-secret',
    };
    return d[k] ?? '';
  }),
});

const makeOAuthMock = () => ({
  getCredenciais: vi
    .fn()
    .mockResolvedValue({ accessToken: 'tok-1', shopId: '999', refreshToken: 'rt' }),
  baseUrl: vi.fn().mockReturnValue('https://partner.shopeemobile.com'),
});

describe('ShopeeClientService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let oauth: ReturnType<typeof makeOAuthMock>;
  let service: ShopeeClientService;

  beforeEach(() => {
    http = makeHttpMock();
    oauth = makeOAuthMock();
    service = new ShopeeClientService(http as never, makeEnvMock() as never, oauth as never);
  });

  describe('getShop/postShop — assinatura e query', () => {
    it('monta URL com partner_id, timestamp, access_token, shop_id, sign', async () => {
      http.request.mockResolvedValue({ data: { response: {} } });

      await service.getShop('emp-1', '/api/v2/orders/get_order_list', { page_size: 50 });

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('partner_id=1234567');
      expect(url).toContain('access_token=tok-1');
      expect(url).toContain('shop_id=999');
      expect(url).toContain('sign=');
      expect(url).toContain('timestamp=');
      expect(url).toContain('page_size=50');
    });

    it('postShop envia body como JSON', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.postShop('emp-1', '/api/v2/sellerchat/send_message', { to_id: 1 });

      expect(http.request.mock.calls[0][0]).toBe('POST');
      expect(http.request.mock.calls[0][2].body).toEqual({ to_id: 1 });
    });

    it('redacta access_token, partner_id e sign nos logs', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.getShop('emp-1', '/x');

      const redact = http.request.mock.calls[0][2].redactKeys;
      expect(redact).toEqual(expect.arrayContaining(['access_token', 'partner_id', 'sign']));
    });
  });

  describe('tratamento de erros Shopee (peculiaridade — HTTP 200 com error no body)', () => {
    it('lança IntegrationException quando data.error está presente (HTTP 200)', async () => {
      http.request.mockResolvedValue({
        data: { error: 'error_auth', message: 'access_token invalid' },
      });

      try {
        await service.getShop('emp-1', '/api/v2/x');
        expect.fail('deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(IntegrationException);
        expect((e as Error).message).toContain('error_auth');
        expect((e as Error).message).toContain('access_token invalid');
      }
    });

    it('embrulha HttpClientError em IntegrationException', async () => {
      http.request.mockRejectedValue(
        new HttpClientError(500, { msg: 'down' }, 'u', 'GET', 1),
      );

      await expect(service.getShop('emp-1', '/x')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('propaga IntegrationException sem re-embrulhar', async () => {
      const ie = new IntegrationException('original');
      http.request.mockRejectedValue(ie);

      await expect(service.getShop('emp-1', '/x')).rejects.toBe(ie);
    });
  });

  describe('getCredenciais', () => {
    it('delega para oauth.getCredenciais', async () => {
      const r = await service.getCredenciais('emp-1');

      expect(r.shopId).toBe('999');
    });
  });
});
