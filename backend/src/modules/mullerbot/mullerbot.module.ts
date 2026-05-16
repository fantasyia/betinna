import { Module } from '@nestjs/common';
import { MullerBotController } from './mullerbot.controller';
import { MullerBotService } from './mullerbot.service';
import { ProdutoSearchService } from './produto-search.service';

@Module({
  controllers: [MullerBotController],
  providers: [MullerBotService, ProdutoSearchService],
  exports: [MullerBotService, ProdutoSearchService],
})
export class MullerBotModule {}
