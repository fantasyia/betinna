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
  agendaItem: { count: vi.fn().mockResolvedValue(2) },
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
