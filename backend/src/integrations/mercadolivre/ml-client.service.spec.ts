import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { MLClientService } from './ml-client.service';

const makeHttpMock = () => ({ request: vi.fn() });
const makeOAuthMock = () => ({
  getAccessToken: vi.fn().mockResolvedValue({ accessToken: 'tok-1', userId: 'user-1' }),
});

describe('MLClientService', () => {
  let http: ReturnType<typeof makeHttpMock>;
  let oauth: ReturnType<typeof makeOAuthMock>;
  let service: MLClientService;

  beforeEach(() => {
    http = makeHttpMock();
    oauth = makeOAuthMock();
    service = new MLClientService(http as never, oauth as never);
  });

  describe('get/post/put', () => {
    it('GET chama http.request com Bearer token e baseURL', async () => {
      http.request.mockResolvedValue({ data: { id: 1 } });

      await service.get('emp-1', '/items/MLB123');

      expect(http.request).toHaveBeenCalledWith(
        'GET',
        'https://api.mercadolibre.com/items/MLB123',
        expect.objectContaining({
          headers: { Authorization: 'Bearer tok-1' },
          integration: 'mercadolivre',
        }),
      );
    });

    it('POST passa body', async () => {
      http.request.mockResolvedValue({ data: { ok: true } });

      await service.post('emp-1', '/answers', { text: 'oi' });

      const opts = http.request.mock.calls[0][2];
      expect(opts.body).toEqual({ text: 'oi' });
      expect(http.request.mock.calls[0][0]).toBe('POST');
    });

    it('PUT passa body', async () => {
      http.request.mockResolvedValue({ data: {} });

      await service.put('emp-1', '/x/1', { v: 1 });

      expect(http.request.mock.calls[0][0]).toBe('PUT');
    });

    it('extrai data da resposta', async () => {
      http.request.mockResolvedValue({ data: { foo: 'bar' } });

      const r = await service.get<{ foo: string }>('emp-1', '/x');

      expect(r.foo).toBe('bar');
    });
  });

  describe('tratamento de erros', () => {
    it('embrulha HttpClientError em IntegrationException com path no message', async () => {
      http.request.mockRejectedValue(
        new HttpClientError(400, { message: 'invalid' }, 'https://x', 'GET', 1),
      );

      try {
        await service.get('emp-1', '/x');
        expect.fail('deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(IntegrationException);
        expect((e as Error).message).toContain('ML GET /x HTTP 400');
      }
    });

    it('propaga erros não-HTTP sem modificar', async () => {
      const generic = new Error('network down');
      http.request.mockRejectedValue(generic);

      await expect(service.get('emp-1', '/x')).rejects.toBe(generic);
    });
  });

  describe('getCredenciais', () => {
    it('retorna o objeto credenciais completo', async () => {
      const r = await service.getCredenciais('emp-1');

      expect(r).toEqual({ accessToken: 'tok-1', userId: 'user-1' });
    });
  });
});
