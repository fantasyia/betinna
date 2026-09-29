import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DeadLetterService } from '@modules/dead-letter/dead-letter.service';
import { MetaLeadgenService } from './meta-leadgen.service';
import { META_LEADGEN_QUEUE, type MetaLeadgenJobData } from './meta-leadgen.types';

/**
 * Worker do Lead Ads. Concorrência baixa (3): é uma chamada ao Graph por lead e
 * o volume de formulário nativo não justifica paralelismo — estourar o rate
 * limit da Meta atrasaria TODOS os leads, não só o excedente.
 *
 * Falha re-tenta com backoff (ver JOB_OPTS). O que esgota — ou nasce sem
 * conserto (`UnrecoverableError`: Página sem conexão, formulário sem contato) —
 * vai pro DEAD-LETTER (29/09), que grava no AuditLog, manda pro Sentry e avisa o
 * diretor. Antes ia pra `failed` calado: lead pago sumia sem ninguém saber.
 * Do dead-letter dá pra reprocessar enquanto o `leadgen_id` não expirou.
 */
@Processor(META_LEADGEN_QUEUE, { concurrency: 3 })
export class MetaLeadgenProcessor extends WorkerHost {
  constructor(
    private readonly leadgen: MetaLeadgenService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MetaLeadgenJobData>, err: Error): Promise<void> {
    const attempts = job.opts?.attempts ?? 1;
    const semConserto = err?.name === 'UnrecoverableError';
    // Ainda vai re-tentar — não é o fim.
    if (!semConserto && job.attemptsMade < attempts) return;
    await this.deadLetter.record({
      originalQueue: META_LEADGEN_QUEUE,
      originalJob: job,
      error: err,
    });
  }

  async process(job: Job<MetaLeadgenJobData>): Promise<void> {
    await this.leadgen.processar(job.data);
  }
}
