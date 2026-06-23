import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IndexacaoProcessor } from './indexacao.processor';
import { IndexacaoService } from './indexacao.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { RagReconciliadorJob } from './rag-reconciliador.job';
import { INDEXACAO_QUEUE } from './rag.types';

/**
 * RAG — indexação semântica (embeddings) + reconciliador. EmbeddingService vem
 * do EmbeddingsModule (@Global). Exporta IndexacaoService pra quem dispara
 * indexação no write (produtos, knowledge).
 */
@Module({
  imports: [BullModule.registerQueue({ name: INDEXACAO_QUEUE })],
  providers: [IndexacaoService, IndexacaoProcessor, RagReconciliadorJob, KnowledgeSearchService],
  exports: [IndexacaoService, KnowledgeSearchService],
})
export class RagModule {}
