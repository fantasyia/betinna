import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
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
 *
 * ⚠️ Rodam SÓ na API: as ações de fluxo enviam WhatsApp pelo socket Baileys, que
 * é EXCLUSIVO da API (o worker não abre socket — D38, anti-conflito de sessão).
 * Se o worker processasse os jobs, todo CONVERSAR_IA/ENVIAR_WHATSAPP falharia com
 * "whatsapp_falha". Por isso, no processo worker este processador se pausa no
 * boot e os jobs de fluxo rodam todos na API (onde o socket vive).
 */
@Processor(FLUXO_QUEUE, { concurrency: 5 })
export class FluxoExecutorProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(FluxoExecutorProcessor.name);

  constructor(
    private readonly executor: FluxoExecutorService,
    private readonly prisma: PrismaService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SERVICE_TYPE === 'worker') {
      try {
        await this.worker.pause();
        this.logger.warn(
          'SERVICE_TYPE=worker — processador de fluxo PAUSADO (socket WhatsApp é API-only). ' +
            'Jobs de fluxo rodam na API.',
        );
      } catch (err) {
        this.logger.warn(
          `Falha ao pausar processador de fluxo no worker: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async process(job: Job<FluxoStepJobData>): Promise<void> {
    const { execucaoId, noId } = job.data;
    this.logger.debug(
      `Job ${job.id}: exec=${execucaoId} no=${noId} (tentativa ${job.attemptsMade + 1})`,
    );
    await this.executor.executarPasso(execucaoId, noId);
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
