import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { CampanhaEnvioProcessor } from './campanha-envio.processor';
import type { CampanhaEnvioJobData } from './campanha-envio.types';

// Foco: onFailed só marca ERRO + dead-letter na falha FINAL (retries esgotados).
const makeDeps = () => ({
  prisma: {
    campanhaDestinatario: { update: vi.fn().mockResolvedValue({}) },
    campanha: { findUnique: vi.fn().mockResolvedValue({ empresaId: 'emp-1' }) },
  },
  campanhasService: { tentarFinalizarCampanha: vi.fn().mockResolvedValue(undefined) },
  deadLetter: { record: vi.fn().mockResolvedValue(undefined) },
});

const makeJob = (attemptsMade: number, attempts: number): Job<CampanhaEnvioJobData> =>
  ({
    data: { campanhaId: 'camp-1', destinatarioId: 'dest-1' },
    opts: { attempts },
    attemptsMade,
  }) as unknown as Job<CampanhaEnvioJobData>;

describe('CampanhaEnvioProcessor.onFailed — #erro-retry', () => {
  let deps: ReturnType<typeof makeDeps>;
  let proc: CampanhaEnvioProcessor;

  beforeEach(() => {
    deps = makeDeps();
    proc = new CampanhaEnvioProcessor(
      deps.prisma as never,
      deps.campanhasService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      deps.deadLetter as never,
      {} as never,
      { suprimido: vi.fn(async () => false) } as never, // supressao
    );
  });

  it('falha INTERMEDIÁRIA (ainda há retries) NÃO marca ERRO nem dead-letter (fica PENDENTE)', async () => {
    await proc.onFailed(makeJob(1, 3), new Error('timeout transitório'));

    expect(deps.prisma.campanhaDestinatario.update).not.toHaveBeenCalled();
    expect(deps.deadLetter.record).not.toHaveBeenCalled();
    expect(deps.campanhasService.tentarFinalizarCampanha).not.toHaveBeenCalled();
  });

  it('falha FINAL (retries esgotados) marca destinatário ERRO + dead-letter + tenta finalizar', async () => {
    await proc.onFailed(makeJob(3, 3), new Error('falhou de vez'));

    expect(deps.prisma.campanhaDestinatario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dest-1' },
        data: expect.objectContaining({ status: 'ERRO' }),
      }),
    );
    expect(deps.deadLetter.record).toHaveBeenCalledTimes(1);
    expect(deps.campanhasService.tentarFinalizarCampanha).toHaveBeenCalledWith('camp-1');
  });
});
