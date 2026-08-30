import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteStatusService } from './site-status.service';

/**
 * A ida e a volta do pedido do site falam línguas diferentes.
 *
 * Aqui o status é de operação (`ENVIADO_ERP` = "subiu pro Tiny"); no site é o
 * que o cliente lê. Mandar o nome de cá fazia a rota de lá recusar TUDO com
 * 400 — e o sintoma era o pior possível: pedido caminhando no ERP e a tela do
 * cliente congelada, sem erro visível pra ninguém.
 */
function build(url = 'https://site/api/pedidos/status', segredo = 's3gr3d0') {
  const http = { post: vi.fn().mockResolvedValue({}) };
  const env = {
    get: vi.fn((k: string) =>
      k === 'SITE_PEDIDOS_STATUS_URL'
        ? url
        : k === 'SITE_PEDIDOS_STATUS_SECRET'
          ? segredo
          : undefined,
    ),
  };
  return { svc: new SiteStatusService(env as never, http as never), http };
}

const corpo = (http: { post: ReturnType<typeof vi.fn> }) => http.post.mock.calls[0][1].body;

describe('aviso de status pro site', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['RASCUNHO', 'recebido'],
    ['AGUARDANDO_APROVACAO', 'recebido'],
    ['ENVIADO_ERP', 'recebido'],
    ['PAGO', 'recebido'],
    ['EM_SEPARACAO', 'em_separacao'],
    ['ENVIADO', 'enviado'],
    ['ENTREGUE', 'entregue'],
    ['CANCELADO', 'cancelado'],
  ])('traduz %s → %s (o site só aceita as palavras dele)', async (betinna, site) => {
    const { svc, http } = build();

    await svc.notificar({ numeroSite: 'SB2608K7M2QX', status: betinna });

    expect(corpo(http).status).toBe(site);
  });

  it('leva rastreio junto — é o que a tela do cliente mostra quando sai pra entrega', async () => {
    const { svc, http } = build();

    await svc.notificar({
      numeroSite: 'SB2608K7M2QX',
      status: 'ENVIADO',
      rastreioCodigo: 'AA123',
      rastreioUrl: 'https://rastreio/AA123',
    });

    expect(corpo(http)).toMatchObject({
      rastreioCodigo: 'AA123',
      rastreioUrl: 'https://rastreio/AA123',
    });
    expect(http.post.mock.calls[0][1].headers['x-pedidos-secret']).toBe('s3gr3d0');
  });

  it('status sem equivalente NÃO vira chamada (400 garantido do outro lado)', async () => {
    const { svc, http } = build();

    expect(await svc.notificar({ numeroSite: 'SB1', status: 'INVENTADO' })).toBe(false);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('pedido que não nasceu no site não tem tela pra atualizar', async () => {
    const { svc, http } = build();

    expect(await svc.notificar({ numeroSite: '', status: 'ENTREGUE' })).toBe(false);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('sem URL/segredo configurados fica quieto (tenant sem site é caso normal)', async () => {
    const { svc, http } = build('', '');

    expect(await svc.notificar({ numeroSite: 'SB1', status: 'ENTREGUE' })).toBe(false);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('site fora do ar NÃO derruba a rodada do ERP', async () => {
    const { svc, http } = build();
    http.post.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await svc.notificar({ numeroSite: 'SB1', status: 'ENTREGUE' })).toBe(false);
  });
});
