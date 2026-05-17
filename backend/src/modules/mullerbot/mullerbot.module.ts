import { Module } from '@nestjs/common';
import { MullerBotController } from './mullerbot.controller';
import { MullerBotService } from './mullerbot.service';
import { MullerBotCacheService } from './mullerbot-cache.service';
import { ProdutoSearchService } from './produto-search.service';

@Module({
  controllers: [MullerBotController],
  providers: [MullerBotService, MullerBotCacheService, ProdutoSearchService],
  exports: [MullerBotService, ProdutoSearchService],
})
export class MullerBotModule {}
