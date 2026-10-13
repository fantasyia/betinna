import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Os filtros de span/transação só valem se estiverem LIGADOS no `Sentry.init`.
 * Testar `limparSpan` sozinho passa mesmo com o gancho apagado do init — este
 * teste é o que pega isso.
 */

const init = vi.fn();
vi.mock('@sentry/node', () => ({
  init: (opts: unknown) => init(opts),
  prismaIntegration: () => ({}),
}));

import { initSentry } from './sentry';

type Opcoes = {
  beforeSendSpan: (s: Record<string, unknown>) => Record<string, unknown>;
  beforeSendTransaction: (e: Record<string, unknown>) => Record<string, unknown>;
};

afterEach(() => {
  vi.unstubAllEnvs();
  init.mockClear();
});

describe('initSentry liga os filtros de span e transação', () => {
  it('o span que sai pelo gancho do init chega sem telefone nem IP', () => {
    vi.stubEnv('SENTRY_DSN', 'https://chave@o0.ingest.sentry.io/1');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    initSentry();

    const opts = init.mock.calls[0]?.[0] as Opcoes;
    const span = opts.beforeSendSpan({
      span_id: 'a',
      trace_id: 'b',
      start_timestamp: 1,
      description: 'GET bot:spam:emp-1:5511999990000@s.whatsapp.net',
      data: { 'client.address': '187.10.20.30' },
    });
    expect(JSON.stringify(span)).not.toContain('5511999990000');
    expect(JSON.stringify(span)).not.toContain('187.10.20.30');

    const transacao = opts.beforeSendTransaction({
      type: 'transaction',
      transaction: 'POST /api/v1/webhooks/tiny/segredo-xyz/pedido',
    });
    expect(transacao.transaction).not.toContain('segredo-xyz');
  });
});
