import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Medição de desempenho do front (22/10).
 *
 * Duas coisas que só um teste segura:
 *
 * 1. `tracePropagationTargets: []`. Por padrão a medição põe os cabeçalhos
 *    `sentry-trace` e `baggage` nas chamadas pra api. A api é outra origem e o
 *    CORS dela só aceita Authorization/Content-Type/X-Empresa-Id/X-Request-Id
 *    (`backend/src/main.ts`) — o preflight recusaria e o app inteiro pararia de
 *    falar com o servidor.
 * 2. Transação e span não passam pelo `beforeSend` (só erro passa). Foi assim
 *    que o backend mandou ~760 telefones/semana pro Sentry até 19/10. Aqui a
 *    URL de busca carrega o que a pessoa digitou (nome de cliente), e nome não
 *    tem forma reconhecível — então a query sai inteira, não só o que o `redact`
 *    reconhece.
 */

const init = vi.fn();
const browserTracingIntegration = vi.fn(() => ({ name: 'BrowserTracing' }));
vi.mock('@sentry/react', () => ({
  init: (opts: unknown) => init(opts),
  browserTracingIntegration: () => browserTracingIntegration(),
  setUser: vi.fn(),
  flush: vi.fn(),
  captureException: vi.fn(),
  SDK_VERSION: 'teste',
}));

type Opcoes = {
  integrations: Array<{ name: string }>;
  tracePropagationTargets: unknown[];
  beforeSendSpan: (s: Record<string, unknown>) => Record<string, unknown>;
  beforeSendTransaction: (e: Record<string, unknown>) => Record<string, unknown>;
};

async function iniciar(): Promise<Opcoes> {
  vi.resetModules();
  vi.stubEnv('VITE_SENTRY_DSN', 'https://chave@o1.ingest.us.sentry.io/2');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const { initSentry } = await import('./sentry');
  initSentry();
  await vi.waitFor(() => expect(init).toHaveBeenCalled());
  return init.mock.calls[0]?.[0] as Opcoes;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  init.mockClear();
});

describe('initSentry liga a medição do front', () => {
  it('com a integração de navegação e SEM repassar cabeçalho de rastreio pra api', async () => {
    const opts = await iniciar();
    expect(opts.integrations.map((i) => i.name)).toContain('BrowserTracing');
    expect(opts.tracePropagationTargets).toEqual([]);
  });

  it('span de chamada à api sai sem a busca digitada e sem PII', async () => {
    const opts = await iniciar();
    const span = opts.beforeSendSpan({
      span_id: 'a',
      trace_id: 'b',
      start_timestamp: 1,
      op: 'http.client',
      description: 'GET https://api.x.test/api/v1/contatos?busca=Maria%20Souza',
      data: {
        'http.url': 'https://api.x.test/api/v1/contatos?busca=Maria%20Souza',
        'url.full': 'https://api.x.test/api/v1/inbox/5511999990000@s.whatsapp.net',
        'http.query': '?busca=Maria%20Souza',
        'http.response.status_code': 200,
      },
    });
    const tudo = JSON.stringify(span);
    expect(tudo).not.toContain('Maria');
    expect(tudo).not.toContain('5511999990000');
    // O que serve pra ler a tela de desempenho fica.
    expect(span.description).toBe('GET https://api.x.test/api/v1/contatos?[filtrado]');
    expect((span.data as Record<string, unknown>)['http.response.status_code']).toBe(200);
  });

  it('transação sai sem token de aceite, sem e-mail e sem IP do usuário', async () => {
    const opts = await iniciar();
    const t = opts.beforeSendTransaction({
      type: 'transaction',
      transaction: '/proposta/aceite/tok-secreto-123',
      request: { url: 'https://app.x.test/contatos?busca=joao@empresa.com.br' },
      user: { id: 'u-1', email: 'joao@empresa.com.br', ip_address: '187.10.20.30' },
      spans: [{ span_id: 'c', description: 'GET /api/v1/kanban/boards/x?q=Maria' }],
      contexts: { trace: { trace_id: 't', span_id: 's', data: { 'url.query': 'q=Maria' } } },
    });
    const tudo = JSON.stringify(t);
    expect(tudo).not.toContain('tok-secreto-123');
    expect(tudo).not.toContain('joao@empresa.com.br');
    expect(tudo).not.toContain('187.10.20.30');
    expect(tudo).not.toContain('Maria');
    expect((t.user as Record<string, unknown>).id).toBe('u-1');
  });
});
