import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanalAdapterRegistry } from './canal-adapter.registry';
import { InboxService } from './inbox.service';

/**
 * Aba Marketplaces (Léo, 29/09): pré-venda (perguntas nos anúncios), pós-venda
 * (mensagens de quem comprou) e reclamações/mediações — separados, com contador.
 */
const ADMIN = { id: 'u1', role: 'ADMIN', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] } as never;
const REP = { id: 'u2', role: 'REP', empresaIdAtiva: 'emp-1', empresaIds: ['emp-1'] } as never;

function montar() {
  const prisma = {
    conversation: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(),
    },
  };
  const svc = new InboxService(
    prisma as never,
    new CanalAdapterRegistry(),
    { get: () => 24 } as never,
    { publicar: () => Promise.resolve() } as never,
    {
      criarParaUsuario: () => Promise.resolve(null),
      criarParaRole: () => Promise.resolve(0),
    } as never,
  );
  return { svc, prisma };
}

/** As condições do `where` da listagem, achatadas pra inspecionar. */
function condicoes(prisma: ReturnType<typeof montar>['prisma']) {
  const where = (
    prisma.conversation.findMany.mock.calls[0] as unknown as [{ where: { AND?: unknown[] } }]
  )[0].where;
  return JSON.stringify(where.AND ?? []);
}

describe('InboxService — grupos de marketplace', () => {
  let m: ReturnType<typeof montar>;
  beforeEach(() => {
    m = montar();
  });

  it('pré-venda filtra PRE_VENDA e fica só nos canais de marketplace', async () => {
    await m.svc.list(ADMIN, { grupo: 'pre_venda', page: 1, limit: 30 } as never);
    const c = condicoes(m.prisma);
    expect(c).toContain('"categoria":{"in":["PRE_VENDA"]}');
    expect(c).toContain('MARKETPLACE_ML');
    expect(c).not.toContain('"WHATSAPP"');
  });

  it('pós-venda inclui GERAL mas NÃO puxa o WhatsApp (fica nos marketplaces)', async () => {
    await m.svc.list(ADMIN, { grupo: 'pos_venda', page: 1, limit: 30 } as never);
    const c = condicoes(m.prisma);
    expect(c).toContain('"categoria":{"in":["POS_VENDA","GERAL"]}');
    expect(c).toContain('"canal":{"in":["MARKETPLACE_ML"');
  });

  it('reclamações cobre reclamação, mediação, devolução e disputa', async () => {
    await m.svc.list(ADMIN, { grupo: 'reclamacoes', page: 1, limit: 30 } as never);
    expect(condicoes(m.prisma)).toContain('["RECLAMACAO","MEDIACAO","DEVOLUCAO","DISPUTA"]');
  });

  it('com canal explícito, respeita o canal e não força a lista de marketplaces', async () => {
    await m.svc.list(ADMIN, {
      grupo: 'pre_venda',
      canal: 'MARKETPLACE_ML',
      page: 1,
      limit: 30,
    } as never);
    const c = condicoes(m.prisma);
    expect(c).toContain('{"canal":"MARKETPLACE_ML"}');
    expect(c).not.toContain('"canal":{"in"');
  });

  it('resumo: soma por canal e grupo; canal sem conversa não aparece', async () => {
    m.prisma.conversation.groupBy.mockResolvedValue([
      { canal: 'MARKETPLACE_ML', categoria: 'PRE_VENDA', _count: { _all: 3 } },
      { canal: 'MARKETPLACE_ML', categoria: 'MEDIACAO', _count: { _all: 1 } },
      { canal: 'MARKETPLACE_ML', categoria: 'POS_VENDA', _count: { _all: 2 } },
      { canal: 'MARKETPLACE_ML', categoria: 'GERAL', _count: { _all: 1 } },
    ]);
    const r = await m.svc.resumoMarketplace(ADMIN);
    expect(r).toEqual([{ canal: 'MARKETPLACE_ML', preVenda: 3, posVenda: 3, reclamacoes: 1 }]);
    const where = (
      m.prisma.conversation.groupBy.mock.calls[0] as unknown as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({ status: { notIn: ['RESOLVIDA', 'ARQUIVADA'] } });
  });

  it('REP: o escopo da listagem (só o próprio WhatsApp) vale pro resumo também', async () => {
    m.prisma.conversation.groupBy.mockResolvedValue([]);
    await m.svc.resumoMarketplace(REP);
    const where = JSON.stringify(
      (m.prisma.conversation.groupBy.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    );
    expect(where).toContain('"proprietarioId":"u2"');
  });
});
