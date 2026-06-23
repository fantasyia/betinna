import { Global, Module } from '@nestjs/common';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { EmbeddingService } from './embedding.service';

/**
 * Embeddings (RAG) — @Global porque é consumido em vários cantos (indexação,
 * busca de produtos, busca de conhecimento). EnvService já é global.
 */
@Global()
@Module({
  imports: [IntegracoesModule],
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingsModule {}
