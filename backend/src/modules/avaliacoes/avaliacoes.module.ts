import { Module } from '@nestjs/common';
import { ShopeeModule } from '@integrations/shopee/shopee.module';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { VitrineModule } from '@modules/vitrine/vitrine.module';
import { AvaliacoesController } from './avaliacoes.controller';
import { AvaliacoesJob } from './avaliacoes.job';
import { AvaliacoesService } from './avaliacoes.service';

/** Avaliações da Shopee na vitrine (25/10, card cmvleo3tv). */
@Module({
  imports: [ShopeeModule, MullerBotModule, VitrineModule],
  controllers: [AvaliacoesController],
  providers: [AvaliacoesService, AvaliacoesJob],
})
export class AvaliacoesModule {}
