import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { FluxoExecutorProcessor } from './fluxo-executor.processor';
import type { FluxoStepJobData } from './fluxo-executor.types';

/**
 * O que estes testes travam: quando um passo esgota os retries, a execução TEM
 * que virar FALHOU. Sem isso ela ficava EM_EXECUCAO pra sempre e o gate
 * anti-reabertura do MENSAGEM_CANAL bloqueava aquela conversa definitivamente —
 * o contato nunca mais virava lead nem era respondido (silêncio total).
 */
const makePrisma = () => ({
  fluxoExecucao: {
    findUnique: vi.fn().mockResolvedValue({ empresaId: 'emp-1' }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
});

const makeJob = (overrides: Partial<Job<FluxoStepJobData>> = {}) =>
  ({
    id: 'job-1',
    data: { execucaoId: 'exec-1', noId: 'no-1' },
    attemptsMade: 3,
    opts: { attempts: 3 },
    ...overrides,
  }) as unknown as Job<FluxoStepJobData>;

describe('FluxoExecutorProcessor.onFailed', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let deadLetter: { record: ReturnType<typeof vi.fn> };
  let processor: FluxoExecutorProcessor;

  beforeEach(() => {
    prisma = makePrisma();
    deadLetter = { record: vi.fn().mockResolvedValue(undefined) };
    processor = new FluxoExecutorProcessor({} as never, prisma as never, deadLetter as never);
  });

  it('marca a execução como FALHOU quando os retries acabam', async () => {
    await processor.onFailed(makeJob(), new Error('Evolution fora do ar'));

    expect(prisma.fluxoExecucao.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exec-1', status: { in: ['PENDENTE', 'EM_EXECUCAO'] } },
        data: expect.objectContaining({ status: 'FALHOU' }),
      }),
    );
  });

  it('NÃO derruba execução AGUARDANDO (tem timeout próprio) nem já finalizada', async () => {
    await processor.onFailed(makeJob(), new Error('x'));

    const where = prisma.fluxoExecucao.updateMany.mock.calls[0][0].where;
    expect(where.status.in).not.toContain('AGUARDANDO');
    expect(where.status.in).not.toContain('CONCLUIDO');
    expect(where.status.in).not.toContain('CANCELADO');
  });

  it('não marca nada enquanto ainda há tentativas (falha intermediária)', async () => {
    await processor.onFailed(makeJob({ attemptsMade: 1 }), new Error('falha temporária'));

    expect(prisma.fluxoExecucao.updateMany).not.toHaveBeenCalled();
    expect(deadLetter.record).not.toHaveBeenCalled();
  });

  it('erro ao marcar FALHOU não impede o registro no dead-letter', async () => {
    prisma.fluxoExecucao.updateMany.mockRejectedValue(new Error('banco fora'));

    await expect(processor.onFailed(makeJob(), new Error('x'))).resolves.toBeUndefined();
    expect(deadLetter.record).toHaveBeenCalledOnce();
  });

  it('a mensagem de erro cita o nó e o número de tentativas', async () => {
    await processor.onFailed(makeJob(), new Error('timeout na API'));

    const data = prisma.fluxoExecucao.updateMany.mock.calls[0][0].data;
    expect(data.erroMsg).toContain('no-1');
    expect(data.erroMsg).toContain('3');
    expect(data.erroMsg).toContain('timeout na API');
  });
});
