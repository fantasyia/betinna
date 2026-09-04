import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoTriggersJob } from './fluxo-triggers.job';
import { TTL_CLAIM_MS } from './conversar-ia.service';

/**
 * Reaper do lock de turno órfão — agora num cron próprio de 2min.
 *
 * Antes vivia dentro do `reconciliarClaims` (15min) com limiar de 5min: um
 * turno morto no deploy deixava o cliente até 20min sem resposta. Aqui, o
 * limiar é o MESMO TTL que o claim usa (3min) e a cadência é 2min.
 */
const makePrisma = () => ({
  fluxoExecucao: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
  },
});

const makeJob = (prisma: ReturnType<typeof makePrisma>, conversarIa: Record<string, unknown>) =>
  new FluxoTriggersJob(
    prisma as never,
    {} as never,
    {} as never,
    { get: () => 'production' } as never,
    { acquire: vi.fn().mockResolvedValue(true) } as never,
    {} as never,
    conversarIa as never,
    {} as never,
    {} as never,
  );

describe('FluxoTriggersJob.destravarTurnosOrfaos', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let conversarIa: { varrerPendentesAposDestravar: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = makePrisma();
    conversarIa = { varrerPendentesAposDestravar: vi.fn().mockResolvedValue(true) };
  });

  it('só considera órfão o lock mais velho que TTL_CLAIM_MS — a mesma régua do claim', async () => {
    const antes = Date.now();
    await makeJob(prisma, conversarIa).destravarTurnosOrfaos();

    const where = prisma.fluxoExecucao.findMany.mock.calls[0]?.[0]?.where;
    expect(where.status).toBe('AGUARDANDO');
    expect(where.processandoTurno).toBe(true);
    const limiar = (where.turnoIniciadoEm.lt as Date).getTime();
    // ≈ agora − 3min (tolerância de 1s pro relógio do teste)
    expect(Math.abs(antes - TTL_CLAIM_MS - limiar)).toBeLessThan(1000);
  });

  it('nada preso → não escreve nada', async () => {
    await makeJob(prisma, conversarIa).destravarTurnosOrfaos();
    expect(prisma.fluxoExecucao.updateMany).not.toHaveBeenCalled();
    expect(conversarIa.varrerPendentesAposDestravar).not.toHaveBeenCalled();
  });

  it('destrava e VARRE cada execução presa — destravar sem varrer é recuperação só no papel', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    await makeJob(prisma, conversarIa).destravarTurnosOrfaos();

    expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1', 'e2'] } },
      data: { processandoTurno: false },
    });
    expect(conversarIa.varrerPendentesAposDestravar).toHaveBeenCalledWith('e1');
    expect(conversarIa.varrerPendentesAposDestravar).toHaveBeenCalledWith('e2');
  });

  it('varredura que falha numa execução não impede a das outras', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    conversarIa.varrerPendentesAposDestravar
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);

    await expect(makeJob(prisma, conversarIa).destravarTurnosOrfaos()).resolves.toBeUndefined();
    expect(conversarIa.varrerPendentesAposDestravar).toHaveBeenCalledTimes(2);
  });
});
