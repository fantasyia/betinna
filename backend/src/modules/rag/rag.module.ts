import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { IndexacaoProcessor } from './indexacao.processor';
import { IndexacaoService } from './indexacao.service';
import { KnowledgeConfigService } from './knowledge-config.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeDocumentoService } from './knowledge-documento.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeService } from './knowledge.service';
import { RagReconciliadorJob } from './rag-reconciliador.job';
import { INDEXACAO_QUEUE } from './rag.types';
import { RODAR_BACKGROUND } from '@shared/utils/service-type';

/**
 * RAG — indexação semântica (embeddings) + reconciliador. EmbeddingService vem
 * do EmbeddingsModule (@Global). Exporta IndexacaoService pra quem dispara
 * indexação no write (produtos, knowledge).
 */
@Module({
  imports: [BullModule.registerQueue({ name: INDEXACAO_QUEUE }), WhatsAppModule],
  controllers: [KnowledgeController],
  providers: [
    IndexacaoService,
    // Processor (consumidor) só no worker; RagReconciliadorJob fica (seu @Cron já é gateado pela
    // ausência do ScheduleModule na api).
    ...(RODAR_BACKGROUND ? [IndexacaoProcessor] : []),
    RagReconciliadorJob,
    KnowledgeSearchService,
    KnowledgeService,
    KnowledgeDocumentoService,
    KnowledgeConfigService,
  ],
  exports: [IndexacaoService, KnowledgeSearchService, KnowledgeConfigService],
})
export class RagModule {}
