import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Sentry from '@sentry/react';

/**
 * Agrupamento dos erros de API no Sentry (30/09).
 *
 * O api-client mandava `API TIMEOUT: GET <url>` como mensagem, e o Sentry troca
 * a URL por um marcador antes de agrupar: TODO timeout de GET caía numa issue e
 * todo de POST noutra. A BETINNA-FRONT-9 (o "Sincronizar ERP", já consertado)
 * "voltou" porque um timeout de `/inbox/:id/presenca` entrou nela.
 *
 * O que se trava: rota diferente → issue diferente; mesma rota com id diferente
 * → MESMA issue (senão cada conversa viraria uma issue).
 */

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock('./auth-store', () => ({
  getSession: () => null,
  getStoredEmpresaId: () => null,
  refreshAccessToken: async () => null,
  refreshFoiTransitorio: () => false,
  clearSession: () => undefined,
}));

import { api, rotaDaApi } from './api';

const capturaMensagem = Sentry.captureMessage as unknown as ReturnType<typeof vi.fn>;
const capturaExcecao = Sentry.captureException as unknown as ReturnType<typeof vi.fn>;

/** fetch que só termina quando o timeout do cliente aborta. */
function fetchQueNuncaResponde() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_r, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  );
}

async function timeoutEm(caminho: string, metodo: 'get' | 'post' = 'get') {
  const p = metodo === 'get' ? api.get(caminho) : api.post(caminho, {});
  const pega = p.catch(() => undefined);
  await vi.advanceTimersByTimeAsync(31_000);
  await pega;
  const ultima = capturaMensagem.mock.calls.at(-1);
  return (ultima?.[1] as { fingerprint?: string[] } | undefined)?.fingerprint;
}

beforeEach(() => {
  vi.useFakeTimers();
  capturaMensagem.mockClear();
  capturaExcecao.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rotaDaApi', () => {
  it.each([
    ['/api/v1/inbox/cmuna5iot000gmn5ivl3fw072/presenca', '/inbox/:id/presenca'],
    ['https://api.exemplo.test/api/v1/kanban/boards/cmrglaqhf000ckslga3jfmwlt?desde=abc', '/kanban/boards/:id'],
    ['/api/v1/pedidos/123', '/pedidos/:id'],
    ['/api/v1/usuarios/842e03c8-cc59-4ff1-804b-c0e8937805e0', '/usuarios/:id'],
    // palavra comum fica: é ela que diz qual endpoint é
    ['/api/v1/notificacoes/nao-lidas', '/notificacoes/nao-lidas'],
    ['/api/v1/integracoes/tiny/sync/produtos', '/integracoes/tiny/sync/produtos'],
  ])('%s → %s', (url, esperado) => {
    expect(rotaDaApi(url)).toBe(esperado);
  });
});

describe('impressão digital no Sentry', () => {
  it('timeout em rotas DIFERENTES do mesmo método → issues diferentes (o caso da FRONT-9)', async () => {
    vi.stubGlobal('fetch', fetchQueNuncaResponde());
    const sync = await timeoutEm('/integracoes/tiny/sync/produtos', 'post');
    const presenca = await timeoutEm('/inbox/cmuna5iot000gmn5ivl3fw072/presenca', 'post');

    expect(sync).toEqual(['api-client', 'TIMEOUT', 'POST', '/integracoes/tiny/sync/produtos']);
    expect(presenca).toEqual(['api-client', 'TIMEOUT', 'POST', '/inbox/:id/presenca']);
  });

  it('mesma rota com ids diferentes → MESMA issue', async () => {
    vi.stubGlobal('fetch', fetchQueNuncaResponde());
    const a = await timeoutEm('/inbox/cmuna5iot000gmn5ivl3fw072/presenca', 'post');
    const b = await timeoutEm('/inbox/cmzzz9iot000gmn5ivl3fw999/presenca', 'post');
    expect(a).toEqual(b);
  });

  it('5xx também agrupa por rota e status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: false, error: { code: 'INTERNAL', message: 'boom' } }),
        text: async () => '',
      })),
    );
    await api.get('/badges').catch(() => undefined);
    const opts = capturaExcecao.mock.calls.at(-1)?.[1] as { fingerprint?: string[] };
    expect(opts.fingerprint).toEqual(['api-client', 'http-500', 'GET', '/badges']);
  });
});
