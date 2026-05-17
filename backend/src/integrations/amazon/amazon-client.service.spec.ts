import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { AmazonClientService } from './amazon-client.service';

const makeHttpMock = () => ({ request: vi.fn() });

const makeEnvMock = (overrides: Record<string, string | boolean> = {}) => ({
  get: vi.fn((k: string) => {
    const defaults: Record<string, string | boolean> = {
      AMAZON_SP_API_REGION: 'NA',
      AMAZON_SANDBOX: false,
      AMAZON_MARKETPLACE_ID: 'A2Q3Y263D00KWC',
      ...overrides,
    };
    return defaults[k];
  }),
});

const makeLwaMock = () => ({
  getCredenciais: vi.fn().mockResolvedValue({ accessToken: 'Atza|test', refreshToken: 'rt' }),
});

describe('AmazonClientService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let lwa: ReturnType<typeof makeLwaMock>;
  let service: AmazonClientService;

  beforeEach(() => {
    http = makeHttpMock();
    lwa = makeLwaMock();
    service = new AmazonClientService(http as never, makeEnvMock() as never, lwa as never);
  });

  describe('baseUrl', () => {
    it('usa host NA por default', () => {
      expect(service.baseUrl).toContain('sellingpartnerapi-na.amazon.com');
    });

    it('usa host sandbox quando AMAZON_SANDBOX=true', () => {
      const sandboxService = new AmazonClientService(
        http as never,
        makeEnvMock({ AMAZON_SANDBOX: true }) as never,
        lwa as never,
      );
      expect(sandboxService.baseUrl).toContain('sandbox');
    });
  });

  describe('marketplaceId', () => {
    it('retorna valor do env', () => {
      expect(service.marketplaceId).toBe('A2Q3Y263D00KWC');
    });
  });

  describe('get/post/put', () => {
    it('GET monta query string e adiciona x-amz-access-token header', async () => {
      http.request.mockResolvedValue({ data: { Orders: [] } });

      await service.get('emp-1', '/orders/v0/orders', {
        MarketplaceIds: 'A2Q3Y263D00KWC',
        MaxResultsPerPage: 50,
      });

      const callArgs = http.request.mock.calls[0];
      expect(callArgs[0]).toBe('GET');
      expect(callArgs[1]).toContain('MarketplaceIds=A2Q3Y263D00KWC');
      expect(callArgs[1]).toContain('MaxResultsPerPage=50');
      expect(callArgs[2].headers['x-amz-access-token']).toBe('Atza|test');
    });

    it('GET omite query params undefined/null', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.get('emp-1', '/path', { a: 'x', b: undefined });

      const url = http.request.mock.calls[0][1];
      expect(url).toContain('a=x');
      expect(url).not.toContain('b=');
    });

    it('POST passa body + query separados', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.post('emp-1', '/x', { foo: 1 }, { q: 'v' });

      expect(http.request.mock.calls[0][0]).toBe('POST');
      expect(http.request.mock.calls[0][1]).toContain('q=v');
      expect(http.request.mock.calls[0][2].body).toEqual({ foo: 1 });
    });

    it('redacta x-amz-access-token nos logs', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.get('emp-1', '/x');

      const opts = http.request.mock.calls[0][2];
      expect(opts.redactKeys).toContain('x-amz-access-token');
    });
  });

  describe('tratamento de erros', () => {
    it('embrulha HttpClientError em IntegrationException', async () => {
      http.request.mockRejectedValue(
        new HttpClientError(403, { errors: [{ code: 'Forbidden', message: 'No access' }] }, 'u', 'GET', 1),
      );

      try {
        await service.get('emp-1', '/x');
        expect.fail('deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(IntegrationException);
        expect((e as Error).message).toContain('Amazon SP-API GET /x HTTP 403');
        expect((e as Error).message).toContain('Forbidden');
      }
    });

    it('extrai detalhe dos errors[] no body Amazon', async () => {
      http.request.mockRejectedValue(
        new HttpClientError(
          400,
          {
            errors: [
              { code: 'InvalidInput', message: 'bad param' },
              { code: 'Validation', message: 'missing field' },
            ],
          },
          'u',
          'GET',
          1,
        ),
      );

      try {
        await service.get('emp-1', '/x');
        expect.fail('throw');
      } catch (e) {
        expect((e as Error).message).toContain('InvalidInput');
        expect((e as Error).message).toContain('Validation');
      }
    });

    it('propaga erros não-HTTP sem modificar', async () => {
      const generic = new Error('boom');
      http.request.mockRejectedValue(generic);

      await expect(service.get('emp-1', '/x')).rejects.toBe(generic);
    });
  });
});
