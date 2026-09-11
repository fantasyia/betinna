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
  const prisma = { pedido: { update: vi.fn().mockResolvedValue({}) } };
  return { svc: new SiteStatusService(env as never, http as never, prisma as never), http, prisma };
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

/**
 * O defeito real de 11/09: a falha do push era DESCARTADA.
 *
 * O site já devolvia 503 + `Retry-After: 30` num soluço de banco (conserto de
 * 09/09) justamente pra autorizar a repetição. Do lado de cá ninguém escutava:
 * uma retentativa imediata, um `logger.warn`, e o sync ainda jogava fora o
 * booleano. Como a rodada seguinte compara o ERP com o NOSSO banco — já
 * atualizado —, ela curto-circuitava em `semMudanca` e o aviso nunca mais saía.
 * Resultado: site com status velho PARA SEMPRE, sem erro em lugar nenhum.
 */
describe('dívida com o site fica registrada e é reenviada', () => {
  beforeEach(() => vi.clearAllMocks());

  const pedido = {
    id: 'p1',
    numeroSite: 'SB1',
    status: 'ENVIADO',
    rastreioCodigo: 'BR123',
    rastreioUrl: 'http://t/BR123',
    siteStatusEnviado: null,
    siteRastreioEnviado: null,
  };

  it('push aceito → grava o que o site passou a saber e limpa o erro', async () => {
    const { svc, prisma } = build();

    expect(await svc.sincronizarPedido(pedido)).toBe(true);

    expect(prisma.pedido.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        siteStatusEnviado: 'enviado',
        siteRastreioEnviado: 'BR123',
        siteErro: null,
        siteErroEm: null,
      },
    });
  });

  it('⭐ push falhou → NÃO fica só no log: marca siteErroEm pro reenvio', async () => {
    const { svc, http, prisma } = build();
    // É exatamente o 503 do site num soluço de banco.
    http.post.mockRejectedValue(new Error('HTTP 503'));

    expect(await svc.sincronizarPedido(pedido)).toBe(false);

    const dados = prisma.pedido.update.mock.calls[0][0].data;
    expect(dados.siteErroEm).toBeInstanceOf(Date);
    expect(dados.siteErro).toContain('enviado');
    // O que o site sabe NÃO pode ser atualizado num push que não entrou —
    // seria dar a dívida por paga.
    expect(dados.siteStatusEnviado).toBeUndefined();
  });

  it('site já em dia → não chama o site de novo (a varredura roda a cada minuto)', async () => {
    const { svc, http, prisma } = build();

    const r = await svc.sincronizarPedido({
      ...pedido,
      siteStatusEnviado: 'enviado',
      siteRastreioEnviado: 'BR123',
    });

    expect(r).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });

  it('só o RASTREIO mudou → reenvia (status igual não é "em dia")', async () => {
    const { svc, http } = build();

    const r = await svc.sincronizarPedido({
      ...pedido,
      siteStatusEnviado: 'enviado',
      siteRastreioEnviado: null,
    });

    expect(r).toBe(true);
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('status sem palavra no site não vira dívida — reenviar seria loop mudo', async () => {
    const { svc, http, prisma } = build();

    const r = await svc.sincronizarPedido({ ...pedido, status: 'STATUS_QUE_NAO_EXISTE' });

    expect(r).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });

  it('pedido que não nasceu no site é ignorado (não tem tela lá)', async () => {
    const { svc, http, prisma } = build();

    expect(await svc.sincronizarPedido({ ...pedido, numeroSite: null })).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });

  it('sem site configurado não inventa dívida', async () => {
    const { svc, prisma } = build('', '');

    expect(await svc.sincronizarPedido(pedido)).toBeNull();
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });
});
