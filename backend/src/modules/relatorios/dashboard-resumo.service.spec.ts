import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { DashboardResumoService } from './dashboard-resumo.service';

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'd@x.ai',
  nome: 'Dir',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...over,
});

const makePrisma = () => ({
  // funil.findMany é chamado 2x: (1) ids de triagem, (2) funis com contagem.
  funil: {
    findMany: vi
      .fn()
      .mockResolvedValueOnce([]) // triagem ids
      .mockResolvedValue([{ id: 'fun-1', nome: 'Clientes', _count: { leads: 3 } }]),
  },
  lead: {
    count: vi.fn().mockResolvedValue(4),
    findMany: vi.fn().mockResolvedValue([]),
  },
  fluxo: {
    groupBy: vi.fn().mockResolvedValue([
      { status: 'RASCUNHO', _count: { _all: 4 } },
      { status: 'PAUSADO', _count: { _all: 2 } },
    ]),
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'fx-1',
        nome: 'E1 - Boas-vindas',
        status: 'PAUSADO',
        triggerTipo: 'LEAD_CRIADO',
        triggerConfig: null,
      },
    ]),
  },
  fluxoExecucao: {
    groupBy: vi.fn().mockResolvedValue([
      { status: 'CONCLUIDO', _count: { _all: 10 } },
      { status: 'FALHOU', _count: { _all: 2 } },
    ]),
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'ex-1',
        fluxoId: 'fx-1',
        erroMsg: 'timeout no envio',
        terminouEm: new Date(),
        criadoEm: new Date(),
        fluxo: { nome: 'E1 - Boas-vindas' },
      },
    ]),
  },
  agendaItem: {
    count: vi.fn().mockResolvedValue(2),
    findMany: vi.fn().mockResolvedValue([]),
  },
  kanbanComentario: {
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'cm-1',
        texto: 'Dir, olha isso aqui',
        criadoEm: new Date(),
        autor: { nome: 'Master' },
        card: { id: 'c-1', titulo: 'Card X', lista: { boardId: 'b-1' } },
      },
    ]),
  },
  funilEtapa: { count: vi.fn().mockResolvedValue(6) },
  evolutionInstancia: { count: vi.fn().mockResolvedValue(0) },
  kanbanBoard: {
    findMany: vi.fn().mockResolvedValue([
      { id: 'b-dir', nome: 'Diretor — Acompanhamento de Tarefas' },
      { id: 'b-nut', nome: '📥 Nutrir — Base de Conhecimento' },
    ]),
  },
  kanbanCard: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(3),
  },
  // 1ª chamada = SLA estourado · 2ª = execuções por dia (sparkline).
  $queryRaw: vi
    .fn()
    .mockResolvedValueOnce([
      {
        id: 'lead-1',
        nome: 'ACME',
        etapaNome: 'Novo',
        etapaDesde: new Date(Date.now() - 5 * 86_400_000),
        slaDias: 3,
        slaHoras: null,
      },
    ])
    .mockResolvedValueOnce([{ fluxoId: 'fx-1', dia: new Date(), ok: 8n, erro: 2n, total: 10n }]),
});

const makeRepScope = (ids: string[] | null) => ({ getRepIds: vi.fn().mockResolvedValue(ids) });

describe('DashboardResumoService', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
  });

  it('pulso agrega os 6 tiles numa chamada (leads, SLA, fluxos, exec 24h, nutrir, tarefas)', async () => {
    const svc = new DashboardResumoService(prisma as never, makeRepScope(null) as never);
    const r = await svc.resumo(user());

    expect(r.pulso).toEqual({
      leadsNovos7d: 4,
      leadsSlaEstourado: 1,
      fluxos: { ativos: 0, total: 6 },
      execucoes24h: { ok: 10, erro: 2 },
      nutrirPendentes: 3,
      tarefasHoje: 2,
    });
  });

  it('MODO PRONTIDÃO liga quando 0 fluxos ativos e lista o que falta (SLA sem ação, WhatsApp)', async () => {
    const svc = new DashboardResumoService(prisma as never, makeRepScope(null) as never);
    const r = await svc.resumo(user());

    expect(r.prontidao.ativo).toBe(true);
    const textos = r.prontidao.linhas.map((l) => l.texto).join(' | ');
    expect(textos).toContain('0/6 fluxos ativos');
    expect(textos).toContain('SLA cadastrado mas SEM ação');
    expect(textos).toContain('WhatsApp da empresa não conectado');
  });

  it('triagem é fila ÚNICA ordenada por urgência — SLA estourado vem antes de falha de fluxo', async () => {
    const svc = new DashboardResumoService(prisma as never, makeRepScope(null) as never);
    const r = await svc.resumo(user());

    expect(r.triagem.length).toBeGreaterThanOrEqual(2);
    expect(r.triagem[0].tipo).toBe('sla');
    const tipos = r.triagem.map((t) => t.tipo);
    expect(tipos).toContain('fluxo_falha');
    expect(tipos).toContain('nutrir');
    // Cada linha tem o PORQUÊ e um link de 1 clique.
    for (const t of r.triagem) {
      expect(t.motivo.length).toBeGreaterThan(0);
      expect(t.link.startsWith('/')).toBe(true);
    }
  });

  it('M6: sala de fluxos com totais 7d + sparkline por dia + último erro', async () => {
    const svc = new DashboardResumoService(prisma as never, makeRepScope(null) as never);
    const r = await svc.resumo(user());

    expect(r.fluxosSala).toHaveLength(1);
    const f = r.fluxosSala[0];
    expect(f.exec7d.total).toBe(10);
    expect(f.pctSucesso).toBe(80);
    expect(f.ultimoErro).toBe('timeout no envio');
    // Série tem 7 buckets e o dia de hoje carrega as execuções.
    expect(f.exec7d.serie).toHaveLength(7);
    expect(f.exec7d.serie[6]).toBe(10);
  });

  it('REP: leads escopados pela carteira e módulos de GESTÃO voltam vazios (sem vazar visão)', async () => {
    const svc = new DashboardResumoService(prisma as never, makeRepScope(['rep-1']) as never);
    const r = await svc.resumo(user({ id: 'rep-1', role: 'REP' as UserRole }));

    // Carteira aplicada na contagem de leads.
    const where = prisma.lead.count.mock.calls[0][0].where;
    expect(where.representanteId).toEqual({ in: ['rep-1'] });
    // Gestão zerada pro REP.
    expect(r.fluxosSala).toEqual([]);
    expect(r.pulso.nutrirPendentes).toBe(0);
    expect(prisma.kanbanBoard.findMany).not.toHaveBeenCalled();
  });
});

// ─── M8 — /dashboard/graficos ───────────────────────────────────────────

const makePrismaGraficos = () => {
  const hoje = new Date();
  return {
    funil: {
      findMany: vi
        .fn()
        // 1ª chamada: funis não-triagem (selector); 2ª: ids de triagem.
        .mockResolvedValueOnce([
          { id: 'fun-1', nome: 'Clientes' },
          { id: 'fun-2', nome: 'Prospecção' },
        ])
        .mockResolvedValue([{ id: 'fun-tri' }]),
    },
    lead: {
      groupBy: vi.fn().mockResolvedValue([
        ...Array.from({ length: 9 }, (_, i) => ({
          utmCampaign: `camp-${i + 1}`,
          _count: { _all: 20 - i },
        })),
        { utmCampaign: 'camp-10', _count: { _all: 1 } },
      ]),
    },
    funilEtapa: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'et-1', nome: 'Novo', cor: '#111111', tipo: 'ATIVA' },
        { id: 'et-2', nome: 'Qualificando', cor: '#222222', tipo: 'ATIVA' },
        { id: 'et-g', nome: 'Ganho', cor: '#333333', tipo: 'GANHO' },
      ]),
    },
    leadEtapaHistorico: {
      groupBy: vi.fn().mockResolvedValue([
        { etapaDestino: 'et-1', _count: { _all: 10 } },
        { etapaDestino: 'et-2', _count: { _all: 4 } },
      ]),
    },
    // 1ª = leads por dia · 2ª = tempo por etapa · 3ª = saúde dos fluxos.
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ dia: hoje, total: 3n }])
      .mockResolvedValueOnce([{ etapa: 'et-1', dias: 2.34 }])
      .mockResolvedValueOnce([{ dia: hoje, ok: 5n, erro: 1n }]),
  };
};

describe('DashboardResumoService.graficos (M8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve as 5 séries numa chamada, com buckets diários zero-fill', async () => {
    const prisma = makePrismaGraficos();
    const svc = new DashboardResumoService(prisma as never, makeRepScope(null) as never);
    const r = await svc.graficos(user(), { dias: 7 });

    // Linha: 7 buckets (zero-fill) e o dia de HOJE carrega os 3 leads.
    expect(r.leadsPorDia).toHaveLength(7);
    expect(r.leadsPorDia[6].total).toBe(3);
    expect(r.leadsPorDia[0].total).toBe(0);
    // Empilhada: mesmo zero-fill, ok/erro de hoje preenchidos.
    expect(r.saudeFluxos).toHaveLength(7);
    expect(r.saudeFluxos[6]).toMatchObject({ ok: 5, erro: 1 });
    // Funis do seletor (sem triagem) + selecionado = 1º.
    expect(r.funis).toHaveLength(2);
    expect(r.funilSelecionado).toEqual({ id: 'fun-1', nome: 'Clientes' });
  });

  it('UTM: ordena por magnitude e agrega a 9ª+ em "Outros" (nunca série nova)', async () => {
    const prisma = makePrismaGraficos();
    const svc = new DashboardResumoService(prisma as never, makeRepScope(null) as never);
    const r = await svc.graficos(user(), { dias: 30 });

    expect(r.utm).toHaveLength(9); // top 8 + Outros
    expect(r.utm[0]).toEqual({ campanha: 'camp-1', total: 20 });
    expect(r.utm[8]).toEqual({ campanha: 'Outros', total: 12 + 1 }); // camp-9 (12) + camp-10 (1)
  });

  it('conversão: só etapas ATIVAS, com taxa de avanço entre consecutivas e tempo médio', async () => {
    const prisma = makePrismaGraficos();
    const svc = new DashboardResumoService(prisma as never, makeRepScope(null) as never);
    const r = await svc.graficos(user(), { dias: 30 });

    expect(r.conversaoFunil).toHaveLength(2); // GANHO fica fora
    expect(r.conversaoFunil[0]).toMatchObject({ nome: 'Novo', entradas: 10, taxaAvanco: 40 });
    expect(r.conversaoFunil[1]).toMatchObject({
      nome: 'Qualificando',
      entradas: 4,
      taxaAvanco: null,
    });
    expect(r.tempoPorEtapa[0]).toMatchObject({ nome: 'Novo', dias: 2.3 });
    expect(r.tempoPorEtapa[1]).toMatchObject({ nome: 'Qualificando', dias: null });
  });

  it('REP: saúde dos fluxos volta VAZIA (módulo de gestão) e carteira entra no groupBy de UTM', async () => {
    const prisma = makePrismaGraficos();
    const svc = new DashboardResumoService(prisma as never, makeRepScope(['rep-1']) as never);
    const r = await svc.graficos(user({ id: 'rep-1', role: 'REP' as UserRole }), { dias: 7 });

    expect(r.saudeFluxos).toEqual([]);
    const where = prisma.lead.groupBy.mock.calls[0][0].where;
    expect(where.representanteId).toEqual({ in: ['rep-1'] });
  });
});
