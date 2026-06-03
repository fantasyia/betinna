import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { MonitorService } from './monitor.service';

const makePrisma = () => ({
  funil: { findMany: vi.fn() },
  lead: { groupBy: vi.fn(), count: vi.fn() },
  fluxoExecucao: { count: vi.fn() },
  fluxo: { count: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
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
    svc = new MonitorService(prisma as never, makeCusto() as never);
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
});
