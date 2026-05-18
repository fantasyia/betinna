import { Module } from '@nestjs/common';
import { MullerBotController } from './mullerbot.controller';
import { MullerBotService } from './mullerbot.service';
import { MullerBotCacheService } from './mullerbot-cache.service';
import { ProdutoSearchService } from './produto-search.service';
import { MullerBotPersonaController } from './persona.controller';
import { MullerBotPersonaService } from './persona.service';

@Module({
  controllers: [MullerBotController, MullerBotPersonaController],
  providers: [
    MullerBotService,
    MullerBotCacheService,
    ProdutoSearchService,
    MullerBotPersonaService,
  ],
  exports: [MullerBotService, ProdutoSearchService, MullerBotPersonaService],
})
export class MullerBotModule {}
