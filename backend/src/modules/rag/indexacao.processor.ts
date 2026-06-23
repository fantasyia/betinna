import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IndexacaoService } from './indexacao.service';
import { INDEXACAO_QUEUE, type IndexacaoJobData } from './rag.types';

/**
 * Worker da indexação semântica. Concorrência baixa (2) — geração de embedding
 * é I/O leve e não pode estourar rate limit da OpenAI. Falha re-tenta (backoff)
 * e, se esgotar, o reconciliador pega o item de novo no próximo ciclo.
 */
@Processor(INDEXACAO_QUEUE, { concurrency: 2 })
export class IndexacaoProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexacaoProcessor.name);

  constructor(private readonly indexacao: IndexacaoService) {
    super();
  }

  async process(job: Job<IndexacaoJobData>): Promise<void> {
    await this.indexacao.processar(job.data);
  }
}
