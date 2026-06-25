import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import { DEAD_LETTER_QUEUE, type DeadLetterJobData } from './dead-letter.types';

/**
 * Service de produção pra Dead Letter Queue.
 *
 * Cada worker no sistema (CampanhaEnvioProcessor, FluxoExecutorProcessor)
 * pode chamar `record()` no listener `worker.on('failed')` quando o BullMQ
 * exauriu todos os retries (`attemptsMade >= attempts`).
 *
 * O DeadLetterProcessor consome a queue e:
 *   - Persiste em AuditLog
 *   - Envia email pro diretor da empresa (quando inferível)
 *
 * O endpoint admin `POST /admin/dead-letter/:id/retry` empurra de volta
 * pra queue original via `requeue()`.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(
    @InjectQueue(DEAD_LETTER_QUEUE)
    private readonly deadLetter: Queue<DeadLetterJobData>,
  ) {}

  /**
   * Registra um job que esgotou todos os retries.
   * Chamado pelos `worker.on('failed')` quando `job.attemptsMade >= attempts`.
   */
  async record(input: {
    originalQueue: string;
    originalJob: Job;
    error: Error | string;
  }): Promise<void> {
    const { originalQueue, originalJob, error } = input;
    const errMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack?.slice(0, 4000) : undefined;
    const data = originalJob.data as Record<string, unknown>;
    const empresaId = typeof data?.empresaId === 'string' ? (data.empresaId as string) : undefined;

    const payload: DeadLetterJobData = {
      originalQueue,
      originalJobId: String(originalJob.id ?? 'unknown'),
      originalJobName: originalJob.name ?? 'unknown',
      originalData: data ?? {},
      error: errMsg,
      stack,
      failedAt: new Date().toISOString(),
      empresaId,
    };

    try {
      await this.deadLetter.add('failed-job', payload, {
        // Não retry nele mesmo — só processa 1x
        attempts: 1,
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 5000 },
      });
    } catch (err) {
      this.logger.error(
        `Falha enfileirando no dead-letter (job=${originalJob.id} queue=${originalQueue}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /**
   * Lista jobs no dead-letter pra exibição admin.
   * Retorna até `limit` (default 50) ordenados por mais recentes.
   */
  async list(limit = 50): Promise<Array<{ id: string; data: DeadLetterJobData; addedAt: number }>> {
    // getJobs devolve AGRUPADO por estado (não por timestamp). Busca uma janela maior e ordena
    // por recência — senão falhas recentes ficavam escondidas atrás de jobs antigos 'completed'.
    const buffer = Math.max(limit, 200);
    const jobs = await this.deadLetter.getJobs(
      ['active', 'waiting', 'completed', 'failed', 'delayed'],
      0,
      buffer - 1,
      false,
    );
    return jobs
      .map((j) => ({
        id: String(j.id),
        data: j.data,
        addedAt: j.timestamp ?? 0,
      }))
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, limit);
  }

  /**
   * Retry — devolve o job pra queue original.
   * Use com cautela: se a causa raiz não foi resolvida, vai falhar de novo.
   */
  async retry(
    deadLetterJobId: string,
    queueRegistry: Map<string, Queue>,
  ): Promise<{ ok: true; reenqueuedAs: string }> {
    const dlJob = await this.deadLetter.getJob(deadLetterJobId);
    if (!dlJob) {
      throw new Error(`Dead-letter job ${deadLetterJobId} não encontrado`);
    }
    const { originalQueue, originalJobName, originalData } = dlJob.data;
    const target = queueRegistry.get(originalQueue);
    if (!target) {
      throw new Error(
        `Queue original ${originalQueue} não registrada no servidor — retry abortado`,
      );
    }
    const requeued = await target.add(originalJobName, originalData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    await dlJob.remove();
    this.logger.log(
      `Dead-letter retry: job ${deadLetterJobId} → ${originalQueue} (novo id ${requeued.id})`,
    );
    return { ok: true, reenqueuedAs: String(requeued.id) };
  }
}
