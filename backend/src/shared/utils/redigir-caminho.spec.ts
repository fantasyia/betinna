import { describe, expect, it } from 'vitest';
import { redigirCaminho } from './redigir-caminho';

/**
 * O segredo do webhook do Tiny viaja no CAMINHO da URL — é a exceção ao D11,
 * porque o ERP não assina os eventos. Todo lugar que ecoa `request.url`
 * (o `meta.path` da resposta, o do erro, o log, o Sentry) publicava a
 * credencial inteira. Este spec tranca o buraco.
 */
describe('redigirCaminho', () => {
  it('some com o segredo do webhook do Tiny e mantém o evento', () => {
    expect(redigirCaminho('/api/v1/webhooks/tiny/um-segredo-longo-qualquer/pedido')).toBe(
      '/api/v1/webhooks/tiny/[REDACTED]/pedido',
    );
  });

  it('redige também quando o segredo está errado — o 401 não pode vazar a tentativa', () => {
    expect(redigirCaminho('/api/v1/webhooks/tiny/errado/pedido')).toBe(
      '/api/v1/webhooks/tiny/[REDACTED]/pedido',
    );
  });

  it('não estraga query string nem outras rotas', () => {
    expect(redigirCaminho('/api/v1/pedidos?page=2')).toBe('/api/v1/pedidos?page=2');
    expect(redigirCaminho('/api/v1/webhooks/meta')).toBe('/api/v1/webhooks/meta');
  });

  it('a query do próprio webhook sobrevive à redação', () => {
    expect(redigirCaminho('/api/v1/webhooks/tiny/abc123/nota?x=1')).toBe(
      '/api/v1/webhooks/tiny/[REDACTED]/nota?x=1',
    );
  });
});
