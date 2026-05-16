import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClientService } from './http-client.service';
import { HttpClientError } from './http-client.types';

const mockResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('HttpClientService', () => {
  let svc: HttpClientService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    svc = new HttpClientService();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('happy path', () => {
    it('GET retorna data parseado', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, { ok: true, n: 1 }));
      const r = await svc.get<{ ok: boolean; n: number }>('http://x.test/a');
      expect(r.status).toBe(200);
      expect(r.data).toEqual({ ok: true, n: 1 });
      expect(r.attempts).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('POST envia body como JSON', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await svc.post('http://x.test/b', { body: { foo: 'bar' } });
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{"foo":"bar"}');
      const headers = init.headers as Record<string, string>;
      expect(headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('retry em 5xx/429', () => {
    it('retenta em 500 e sucede no segundo attempt', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse(500, { erro: 'temp' }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const r = await svc.get('http://x.test/retry', { retryBaseMs: 1 });
      expect(r.status).toBe(200);
      expect(r.attempts).toBe(2);
    });

    it('retenta em 429 honrando Retry-After (segundos)', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, { erro: 'rate' }, { 'retry-after': '0' }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const r = await svc.get('http://x.test/rate', { retryBaseMs: 1 });
      expect(r.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('estoura attempts e lança HttpClientError com último status', async () => {
      fetchSpy.mockResolvedValue(mockResponse(503, { erro: 'down' }));

      await expect(
        svc.get('http://x.test/down', { retries: 1, retryBaseMs: 1 }),
      ).rejects.toBeInstanceOf(HttpClientError);
      expect(fetchSpy).toHaveBeenCalledTimes(2); // 1 + 1 retry
    });
  });

  describe('4xx não retenta', () => {
    it('400 lança HttpClientError em primeira tentativa', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(400, { erro: 'bad' }));

      const promise = svc.get('http://x.test/bad', { retries: 3, retryBaseMs: 1 });
      await expect(promise).rejects.toThrow(HttpClientError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('404 lança HttpClientError preservando body', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(404, { erro: 'nao_encontrado' }));
      try {
        await svc.get('http://x.test/nf');
        expect.fail('deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpClientError);
        expect((e as HttpClientError).status).toBe(404);
        expect((e as HttpClientError).body).toEqual({ erro: 'nao_encontrado' });
      }
    });
  });

  describe('erro de rede', () => {
    it('TypeError de rede retenta', async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const r = await svc.get('http://x.test/net', { retryBaseMs: 1 });
      expect(r.status).toBe(200);
      expect(r.attempts).toBe(2);
    });

    it('lança HttpClientError com status=0 quando esgota retries', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
      try {
        await svc.get('http://x.test/dead', { retries: 1, retryBaseMs: 1 });
        expect.fail('deveria lançar');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpClientError);
        expect((e as HttpClientError).status).toBe(0);
      }
    });
  });
});
