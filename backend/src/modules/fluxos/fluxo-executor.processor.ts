import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '@database/prisma.service';
import { DeadLetterService } from '@modules/dead-letter/dead-letter.service';
import { FLUXO_QUEUE, type FluxoStepJobData } from './fluxo-executor.types';
import { FluxoExecutorService } from './fluxo-executor.service';

/**
 * FluxoExecutorProcessor — worker BullMQ que executa um passo por vez.
 *
 * Cada job carrega `{ execucaoId, noId }` e delega ao FluxoExecutorService.
 * O próprio executor enfileira o(s) próximo(s) nó(s) após a execução.
 *
 * Concorrência: 5 jobs simultâneos — configurável via `concurrency`.
 * Retry: 3 tentativas com backoff exponencial (configurado no producer).
 */
@Processor(FLUXO_QUEUE, { concurrency: 5 })
export class FluxoExecutorProcessor extends WorkerHost {
  private readonly logger = new Logger(FluxoExecutorProcessor.name);

  constructor(
    private readonly executor: FluxoExecutorService,
    private readonly prisma: PrismaService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<FluxoStepJobData>): Promise<void> {
    const { execucaoId, noId } = job.data;
    this.logger.debug(
      `Job ${job.id}: exec=${execucaoId} no=${noId} (tentativa ${job.attemptsMade + 1})`,
    );
    // job.id é a chave do claim de idempotência (estável no retry, fresco por enqueue).
    await this.executor.executarPasso(execucaoId, noId, job.id!);
  }

  /**
   * Sprint 3 FIX 3: dead-letter on final failure.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<FluxoStepJobData>, err: Error): Promise<void> {
    const attempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    // Enriquece com empresaId via FluxoExecucao
    let empresaId: string | undefined;
    try {
      const exec = await this.prisma.fluxoExecucao.findUnique({
        where: { id: job.data.execucaoId },
        select: { empresaId: true },
      });
      empresaId = exec?.empresaId;
    } catch {
      /* fica undefined */
    }
    if (empresaId) {
      (job.data as unknown as Record<string, unknown>).empresaId = empresaId;
    }
    await this.deadLetter.record({
      originalQueue: FLUXO_QUEUE,
      originalJob: job,
      error: err,
    });
  }
}
