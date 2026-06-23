import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IndexacaoProcessor } from './indexacao.processor';
import { IndexacaoService } from './indexacao.service';
import { KnowledgeConfigService } from './knowledge-config.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeService } from './knowledge.service';
import { RagReconciliadorJob } from './rag-reconciliador.job';
import { INDEXACAO_QUEUE } from './rag.types';

/**
 * RAG — indexação semântica (embeddings) + reconciliador. EmbeddingService vem
 * do EmbeddingsModule (@Global). Exporta IndexacaoService pra quem dispara
 * indexação no write (produtos, knowledge).
 */
@Module({
  imports: [BullModule.registerQueue({ name: INDEXACAO_QUEUE })],
  controllers: [KnowledgeController],
  providers: [
    IndexacaoService,
    IndexacaoProcessor,
    RagReconciliadorJob,
    KnowledgeSearchService,
    KnowledgeService,
    KnowledgeConfigService,
  ],
  exports: [IndexacaoService, KnowledgeSearchService, KnowledgeConfigService],
})
export class RagModule {}
