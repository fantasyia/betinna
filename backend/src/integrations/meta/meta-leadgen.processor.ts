import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MetaLeadgenService } from './meta-leadgen.service';
import { META_LEADGEN_QUEUE, type MetaLeadgenJobData } from './meta-leadgen.types';

/**
 * Worker do Lead Ads. Concorrência baixa (3): é uma chamada ao Graph por lead e
 * o volume de formulário nativo não justifica paralelismo — estourar o rate
 * limit da Meta atrasaria TODOS os leads, não só o excedente.
 *
 * Falha re-tenta com backoff (ver JOB_OPTS). O que esgota vai pra `failed`, de
 * onde ainda dá pra reprocessar enquanto o `leadgen_id` não expirou.
 */
@Processor(META_LEADGEN_QUEUE, { concurrency: 3 })
export class MetaLeadgenProcessor extends WorkerHost {
  constructor(private readonly leadgen: MetaLeadgenService) {
    super();
  }

  async process(job: Job<MetaLeadgenJobData>): Promise<void> {
    await this.leadgen.processar(job.data);
  }
}
