import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { captureException } from '@shared/observability/sentry';
import { TinyProdutosSyncService, type ResultadoSync } from './tiny-produtos-sync.service';
import { TINY_SYNC_PRODUTOS_QUEUE, type TinySyncProdutosJobData } from './tiny.types';

/**
 * Worker do sync de produtos disparado pela tela.
 *
 * Concorrência 1: a API do Tiny tem rate limit por conta, e dois catálogos
 * inteiros ao mesmo tempo só disputariam a mesma cota.
 */
@Processor(TINY_SYNC_PRODUTOS_QUEUE, { concurrency: 1 })
export class TinyProdutosSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(TinyProdutosSyncProcessor.name);

  constructor(private readonly sync: TinyProdutosSyncService) {
    super();
  }

  async process(job: Job<TinySyncProdutosJobData, ResultadoSync>): Promise<ResultadoSync> {
    return this.sync.sync(job.data.empresaId, { modo: job.data.modo });
  }

  /**
   * Falha do sync INTEIRO (token do Tiny, página que não veio). Produto a
   * produto o sync já absorve e conta em `erros`. Aqui vai pro Sentry porque,
   * no worker, ninguém mais olha — a tela só vê se ainda estiver aberta.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<TinySyncProdutosJobData> | undefined, err: Error): void {
    this.logger.error(`[tiny] sync de produtos (job ${job?.id}) falhou: ${err.message}`);
    captureException(
      err,
      { fila: TINY_SYNC_PRODUTOS_QUEUE, jobId: job?.id, empresaId: job?.data?.empresaId },
      [TINY_SYNC_PRODUTOS_QUEUE, 'sync-produtos'],
    );
  }
}
