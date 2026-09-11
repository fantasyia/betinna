import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteStatusRetryJob } from './site-status-retry.job';

/**
 * A metade que faltava do conserto de 09/09.
 *
 * O site passou a devolver 503 + `Retry-After: 30` pra autorizar a repetição.
 * Não havia ninguém repetindo: o sync do ERP só reavisa quando `mudou`, e
 * `mudou` compara o ERP com o nosso banco — atualizado antes do push. Estes
 * testes existem pra que "a rodada seguinte reenvia" deixe de ser comentário e
 * passe a ser linha executada.
 */
function build(pedidos: unknown[] = [], resultado: boolean | null = true) {
  const prisma = {
    pedido: {
      findMany: vi.fn().mockResolvedValue(pedidos),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const site = {
    configurado: true,
    sincronizarPedido: vi.fn().mockResolvedValue(resultado),
  };
  const cronLock = { acquire: vi.fn().mockResolvedValue(true) };
  const env = { get: vi.fn(() => 'production') };
  const job = new SiteStatusRetryJob(
    env as never,
    prisma as never,
    cronLock as never,
    site as never,
  );
  return { job, prisma, site, cronLock, env };
}

const atrasado = {
  id: 'p1',
  numero: 'PED-0001',
  numeroSite: 'SB1',
  status: 'ENVIADO',
  rastreioCodigo: 'BR1',
  rastreioUrl: null,
  siteStatusEnviado: null,
  siteRastreioEnviado: null,
};

describe('varredura de reenvio pro site', () => {
  beforeEach(() => vi.clearAllMocks());

  it('⭐ reenvia o pedido cujo push falhou — a dívida não morre no log', async () => {
    const { job, site } = build([atrasado]);

    await job.reenviar();

    expect(site.sincronizarPedido).toHaveBeenCalledTimes(1);
    expect(site.sincronizarPedido.mock.calls[0][0]).toMatchObject({ id: 'p1', status: 'ENVIADO' });
  });

  it('procura só quem falhou e tem tela no site', async () => {
    const { job, prisma } = build([atrasado]);

    await job.reenviar();

    const where = prisma.pedido.findMany.mock.calls[0][0].where;
    expect(where.siteErroEm).toEqual({ not: null });
    expect(where.numeroSite).toEqual({ not: null });
  });

  it('falhou de novo → NÃO limpa a marca (continua devendo)', async () => {
    const { job, prisma } = build([atrasado], false);

    await job.reenviar();

    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });

  it('site já estava em dia → limpa a marca, senão volta toda rodada pra sempre', async () => {
    const { job, prisma } = build([atrasado], null);

    await job.reenviar();

    expect(prisma.pedido.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { siteErro: null, siteErroEm: null },
    });
  });

  it('um pedido problemático não derruba a varredura', async () => {
    const { job, prisma, site } = build([atrasado, { ...atrasado, id: 'p2', numero: 'PED-0002' }]);
    site.sincronizarPedido.mockRejectedValueOnce(new Error('boom'));

    await job.reenviar();

    expect(site.sincronizarPedido).toHaveBeenCalledTimes(2);
    expect(prisma.pedido.update).not.toHaveBeenCalled();
  });

  it('sem lock (outra réplica já varrendo) não consulta o banco', async () => {
    const { job, prisma, cronLock } = build([atrasado]);
    cronLock.acquire.mockResolvedValue(false);

    await job.reenviar();

    expect(prisma.pedido.findMany).not.toHaveBeenCalled();
  });

  it('tenant sem site configurado não varre', async () => {
    const { job, prisma, site } = build([atrasado]);
    site.configurado = false;

    await job.reenviar();

    expect(prisma.pedido.findMany).not.toHaveBeenCalled();
  });

  it('nada atrasado → silêncio (log por minuto sem novidade esconde o que importa)', async () => {
    const { job, site } = build([]);

    await job.reenviar();

    expect(site.sincronizarPedido).not.toHaveBeenCalled();
  });
});
