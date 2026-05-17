import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { TikTokClientService } from './tiktok-client.service';

const makeHttpMock = () => ({ request: vi.fn() });

const makeEnvMock = () => ({
  get: vi.fn((k: string) => {
    const d: Record<string, string> = {
      TIKTOK_APP_KEY: 'app-k',
      TIKTOK_APP_SECRET: 'app-s',
    };
    return d[k] ?? '';
  }),
});

const makeOAuthMock = () => ({
  getCredenciais: vi.fn().mockResolvedValue({
    accessToken: 'tok-1',
    shopId: 'shop-1',
    shopCipher: 'cipher-1',
  }),
});

describe('TikTokClientService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let oauth: ReturnType<typeof makeOAuthMock>;
  let service: TikTokClientService;

  beforeEach(() => {
    http = makeHttpMock();
    oauth = makeOAuthMock();
    service = new TikTokClientService(http as never, makeEnvMock() as never, oauth as never);
  });

  describe('assinatura e query', () => {
    it('GET inclui app_key, timestamp, shop_id, shop_cipher, sign, access_token', async () => {
      http.request.mockResolvedValue({ data: { code: 0, data: {} } });

      await service.get('emp-1', '/order/202309/orders/search');

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('app_key=app-k');
      expect(url).toContain('shop_id=shop-1');
      expect(url).toContain('shop_cipher=cipher-1');
      expect(url).toContain('sign=');
      expect(url).toContain('access_token=tok-1');
      expect(url).toContain('timestamp=');
    });

    it('POST envia body como JSON e content-type header', async () => {
      http.request.mockResolvedValue({ data: { code: 0 } });

      await service.post('emp-1', '/x', { foo: 1 });

      const opts = http.request.mock.calls[0][2];
      expect(opts.body).toEqual({ foo: 1 });
      expect(opts.headers['content-type']).toBe('application/json');
    });

    it('extraQuery é mesclado aos params', async () => {
      http.request.mockResolvedValue({ data: { code: 0 } });

      await service.get('emp-1', '/x', { page_size: 50 });

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('page_size=50');
    });

    it('redacta access_token, app_secret, sign e app_key nos logs', async () => {
      http.request.mockResolvedValue({ data: { code: 0 } });

      await service.get('emp-1', '/x');

      const redact = http.request.mock.calls[0][2].redactKeys;
      expect(redact).toEqual(
        expect.arrayContaining(['access_token', 'app_secret', 'sign', 'app_key']),
      );
    });
  });

  describe('tratamento de erros TikTok (envelope code/message)', () => {
    it('lança IntegrationException quando data.code !== 0', async () => {
      http.request.mockResolvedValue({ data: { code: 36004001, message: 'param error' } });

      try {
        await service.get('emp-1', '/x');
        expect.fail('deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(IntegrationException);
        expect((e as Error).message).toContain('code=36004001');
        expect((e as Error).message).toContain('param error');
      }
    });

    it('aceita data.code === 0 como sucesso', async () => {
      http.request.mockResolvedValue({ data: { code: 0, data: { x: 1 } } });

      const r = await service.get<{ code: number; data: { x: number } }>('emp-1', '/x');

      expect(r.code).toBe(0);
    });

    it('aceita resposta sem code (não falha)', async () => {
      http.request.mockResolvedValue({ data: { something: true } });

      const r = await service.get<{ something: boolean }>('emp-1', '/x');

      expect(r.something).toBe(true);
    });

    it('embrulha HttpClientError em IntegrationException', async () => {
      http.request.mockRejectedValue(new HttpClientError(500, {}, 'u', 'GET', 1));

      await expect(service.get('emp-1', '/x')).rejects.toBeInstanceOf(IntegrationException);
    });
  });
});
