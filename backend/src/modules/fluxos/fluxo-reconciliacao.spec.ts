import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FluxoTriggersJob } from './fluxo-triggers.job';

/**
 * Reaper de execuções ABANDONADAS.
 *
 * O caso real: a execução `cmsjoo6or…` ficou EM_EXECUCAO desde 08/08 —
 * terminouEm null, erroMsg null, tentativas 0. O `onFailed` do processor só
 * marca FALHOU quando existe um job que falhou; se o job nunca chegou a existir
 * (enqueue perdido, worker fora do ar, jobId rejeitado), nada nunca mais mexe
 * naquela linha. E o anti-reabertura do MENSAGEM_CANAL trata
 * PENDENTE/EM_EXECUCAO/AGUARDANDO como "já tem execução viva" — ou seja, aquela
 * conversa fica bloqueada em definitivo, sem erro em lugar nenhum.
 */
const makePrisma = () => ({
  fluxoStepClaim: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  fluxoExecucao: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
});

const makeJob = (prisma: ReturnType<typeof makePrisma>, bus: Record<string, unknown>) =>
  new FluxoTriggersJob(
    prisma as never,
    {} as never,
    bus as never,
    { get: () => 'production' } as never,
    { acquire: vi.fn().mockResolvedValue(true) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('FluxoTriggersJob.reconciliarClaims — execuções abandonadas', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('marca FALHOU a execução parada SEM job vivo na fila', async () => {
    prisma.fluxoExecucao.findMany
      .mockResolvedValueOnce([]) // candidatas de cron (outro trecho)
      .mockResolvedValueOnce([{ id: 'exec-morta' }, { id: 'exec-viva' }]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockResolvedValue(new Set(['exec-viva'])),
      jobExiste: vi.fn(),
    };

    await makeJob(prisma, bus).reconciliarClaims();

    const chamada = prisma.fluxoExecucao.updateMany.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FALHOU',
    );
    expect(chamada).toBeDefined();
    // Só a morta — a viva tem job delayed (ex: nó DELAY de 3 dias) e NÃO pode morrer.
    expect((chamada![0] as { where: { id: { in: string[] } } }).where.id.in).toEqual([
      'exec-morta',
    ]);
  });

  it('execução com job vivo NÃO é tocada (DELAY longo é legítimo)', async () => {
    prisma.fluxoExecucao.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'exec-delay' }]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockResolvedValue(new Set(['exec-delay'])),
      jobExiste: vi.fn(),
    };

    await makeJob(prisma, bus).reconciliarClaims();

    const marcou = prisma.fluxoExecucao.updateMany.mock.calls.some(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FALHOU',
    );
    expect(marcou).toBe(false);
  });

  it('fila inacessível → NÃO varre nada (senão todo delayed viraria abandonada)', async () => {
    prisma.fluxoExecucao.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'exec-1' }]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockRejectedValue(new Error('redis down')),
      jobExiste: vi.fn(),
    };

    await makeJob(prisma, bus).reconciliarClaims();

    const marcou = prisma.fluxoExecucao.updateMany.mock.calls.some(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FALHOU',
    );
    expect(marcou).toBe(false);
  });

  it('o update só pega quem AINDA está PENDENTE/EM_EXECUCAO (corrida com o worker)', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'e1' }]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockResolvedValue(new Set<string>()),
      jobExiste: vi.fn(),
    };

    await makeJob(prisma, bus).reconciliarClaims();

    const chamada = prisma.fluxoExecucao.updateMany.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FALHOU',
    )![0] as { where: { status: { in: string[] } }; data: { erroMsg: string } };
    expect(chamada.where.status.in).toEqual(['PENDENTE', 'EM_EXECUCAO']);
    expect(chamada.data.erroMsg).toMatch(/abandonada/i);
  });
});
