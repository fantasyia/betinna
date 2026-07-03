import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { MonitorService } from './monitor.service';

const makePrisma = () => ({
  funil: { findMany: vi.fn() },
  lead: { groupBy: vi.fn(), count: vi.fn() },
  fluxoExecucao: { count: vi.fn() },
  fluxo: { count: vi.fn() },
  campanha: { findMany: vi.fn().mockResolvedValue([]) },
  campanhaDestinatario: { groupBy: vi.fn().mockResolvedValue([]) },
  $queryRaw: vi.fn().mockResolvedValue([]),
});
const makeQueue = () => ({
  getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, delayed: 0, active: 0, failed: 0 }),
});
const makeCusto = () => ({
  statusCusto: vi.fn().mockResolvedValue({ diaIn: 0, diaOut: 0, mesIn: 0, mesOut: 0 }),
});

const user: AuthenticatedUser = {
  id: 'u1',
  email: 'd@x.com',
  nome: 'D',
  role: 'DIRECTOR' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
};

describe('MonitorService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: MonitorService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new MonitorService(
      prisma as never,
      makeCusto() as never,
      makeQueue() as never,
      makeQueue() as never,
      makeQueue() as never,
    );
  });

  it('monta o resumo: leads por etapa, total, SLAs vencidos e contadores', async () => {
    prisma.funil.findMany.mockResolvedValue([
      {
        id: 'f1',
        nome: 'Reps',
        cor: '#000',
        etapas: [
          { id: 'e1', nome: 'Prospecção', cor: '#111', tipo: 'ATIVA', slaDias: 7 },
          { id: 'e2', nome: 'Abordagem', cor: '#222', tipo: 'ATIVA', slaDias: null },
        ],
      },
    ]);
    prisma.lead.groupBy.mockResolvedValue([
      { funilEtapaId: 'e1', _count: { _all: 100 } },
      { funilEtapaId: 'e2', _count: { _all: 10 } },
    ]);
    prisma.lead.count.mockResolvedValue(3); // SLA vencidos na e1 (única com slaDias)
    prisma.fluxoExecucao.count.mockResolvedValue(5);
    prisma.fluxo.count.mockResolvedValue(2);

    const r = await svc.resumo(user);

    expect(r.funis[0].total).toBe(110);
    expect(r.funis[0].etapas[0].leads).toBe(100);
    expect(r.slaVencidos).toBe(3);
    expect(prisma.lead.count).toHaveBeenCalledTimes(1); // só a etapa com slaDias
    expect(r.iaAtivas).toBe(5);
    expect(r.fluxosAtivos).toBe(2);
    expect(r.execucoes.total).toBe(5);
  });

  it('filas: agrega pendências por campanha e totais por canal; DIRECTOR não vê sistema', async () => {
    prisma.campanha.findMany.mockResolvedValue([
      { id: 'c1', nome: 'Promo Zap', canal: 'WHATSAPP', status: 'ENVIANDO' },
      { id: 'c2', nome: 'News', canal: 'EMAIL', status: 'AGENDADA' },
      { id: 'c3', nome: 'Dupla', canal: 'WHATSAPP_EMAIL', status: 'PAUSADA' },
    ]);
    prisma.campanhaDestinatario.groupBy.mockResolvedValue([
      { campanhaId: 'c1', status: 'PENDENTE', _count: { _all: 40 } },
      { campanhaId: 'c1', status: 'ENVIADO', _count: { _all: 10 } },
      { campanhaId: 'c2', status: 'PENDENTE', _count: { _all: 7 } },
      { campanhaId: 'c3', status: 'PENDENTE', _count: { _all: 5 } },
      { campanhaId: 'c3', status: 'ERRO', _count: { _all: 2 } },
    ]);

    const r = await svc.filas(user);

    expect(r.campanhas).toHaveLength(3);
    expect(r.campanhas.find((c) => c.id === 'c1')).toMatchObject({ pendentes: 40, enviados: 10 });
    // WHATSAPP_EMAIL conta nos dois canais
    expect(r.totais).toEqual({ whatsappPendentes: 45, emailPendentes: 12 });
    expect(r.sistema).toBeNull();
  });

  it('filas: ADMIN vê contadores das filas técnicas (BullMQ)', async () => {
    const admin = { ...user, role: 'ADMIN' as UserRole };
    const r = await svc.filas(admin);
    expect(r.sistema).not.toBeNull();
    expect(r.sistema?.fluxo).toEqual({ aguardando: 0, agendados: 0, executando: 0, falhas: 0 });
    expect(r.sistema?.deadLetter).toBe(0);
  });
});
