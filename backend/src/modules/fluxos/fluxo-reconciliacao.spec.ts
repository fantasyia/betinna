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
  fluxoNo: { findFirst: vi.fn().mockResolvedValue({ id: 'no-trigger' }) },
  fluxoExecucao: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  },
});

/** Execução parada, como a reconciliação a lê. `passos` = quantos já rodaram. */
const parada = (id: string, passos = 0, contexto: Record<string, unknown> = {}) => ({
  id,
  fluxoId: 'f1',
  contexto,
  _count: { logs: passos },
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
      // 2 passos já rodados: reprocessar reenviaria o que já foi enviado.
      .mockResolvedValueOnce([parada('exec-morta', 2), parada('exec-viva', 2)]);
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
      .mockResolvedValueOnce([parada('exec-delay', 1)]);
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
      .mockResolvedValueOnce([parada('exec-1', 1)]);
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
    prisma.fluxoExecucao.findMany
      .mockResolvedValueOnce([]) // candidatas de cron
      .mockResolvedValueOnce([parada('e1', 3)]);
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

  it('execução com ZERO passos é RE-ENFILEIRADA, não morta — nada foi enviado ainda', async () => {
    // Era o caso do deploy que derrubou o worker: a mensagem do lead virava
    // execução, ninguém consumia, e o reaper matava — o lead nunca era atendido.
    prisma.fluxoExecucao.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([parada('e0')]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockResolvedValue(new Set<string>()),
      jobExiste: vi.fn(),
      dispararDireto: vi.fn().mockResolvedValue(undefined),
    };

    await makeJob(prisma, bus).reconciliarClaims();

    expect(bus.dispararDireto).toHaveBeenCalledWith('e0', 'no-trigger');
    const matou = prisma.fluxoExecucao.updateMany.mock.calls.some(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FALHOU',
    );
    expect(matou).toBe(false);
  });

  it('re-enfileira UMA vez só — a segunda passada mata, pra não virar loop', async () => {
    prisma.fluxoExecucao.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([parada('e0', 0, { _reenfileiradoEm: '2026-09-05T22:00:00.000Z' })]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockResolvedValue(new Set<string>()),
      jobExiste: vi.fn(),
      dispararDireto: vi.fn().mockResolvedValue(undefined),
    };

    await makeJob(prisma, bus).reconciliarClaims();

    expect(bus.dispararDireto).not.toHaveBeenCalled();
    const chamada = prisma.fluxoExecucao.updateMany.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FALHOU',
    );
    expect((chamada![0] as { where: { id: { in: string[] } } }).where.id.in).toEqual(['e0']);
  });

  it('a marca de re-enfileirado é gravada ANTES de enfileirar', async () => {
    prisma.fluxoExecucao.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([parada('e0')]);
    const bus = {
      execucoesComJobVivo: vi.fn().mockResolvedValue(new Set<string>()),
      jobExiste: vi.fn(),
      dispararDireto: vi.fn().mockResolvedValue(undefined),
    };

    await makeJob(prisma, bus).reconciliarClaims();

    const arg = prisma.fluxoExecucao.update.mock.calls[0]?.[0] as {
      data: { contexto: Record<string, unknown> };
    };
    expect(arg.data.contexto._reenfileiradoEm).toBeTruthy();
  });
});

describe('FluxoTriggersJob.alarmeDeFilaParada', () => {
  it('PENDENTE com zero passos há mais de 5min vira ERROR no log', async () => {
    // Condição que nunca é normal: o job é enfileirado no mesmo instante em que
    // a execução nasce. Em 05/09 a fila ficou 35min parada sem nenhum sinal.
    const prisma = makePrisma();
    prisma.fluxoExecucao.count.mockResolvedValue(3);
    const job = makeJob(prisma, {});
    const erro = vi.spyOn(job['logger'], 'error').mockImplementation(() => undefined);

    await job.alarmeDeFilaParada();

    expect(erro).toHaveBeenCalledWith(expect.stringMatching(/3 execução\(ões\) PENDENTE/));
    const where = prisma.fluxoExecucao.count.mock.calls[0]?.[0] as {
      where: { status: string; logs: { none: Record<string, never> } };
    };
    expect(where.where.status).toBe('PENDENTE');
    expect(where.where.logs).toEqual({ none: {} });
  });

  it('fila saudável não gera ruído', async () => {
    const prisma = makePrisma();
    prisma.fluxoExecucao.count.mockResolvedValue(0);
    const job = makeJob(prisma, {});
    const erro = vi.spyOn(job['logger'], 'error').mockImplementation(() => undefined);

    await job.alarmeDeFilaParada();

    expect(erro).not.toHaveBeenCalled();
  });
});
