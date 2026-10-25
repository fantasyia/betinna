import { Module } from '@nestjs/common';
import { MLModule } from '@integrations/mercadolivre/ml.module';
import { ShopeeModule } from '@integrations/shopee/shopee.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { RagModule } from '@modules/rag/rag.module';
import { PendenciasIaService } from './pendencias-ia.service';
import { PendenciasController } from './pendencias.controller';
import { PendenciasJob } from './pendencias.job';
import { PendenciasService } from './pendencias.service';
import { VerificadoresService } from './verificadores.service';

/** Pendências de marketplace + rotina (a cada 15 min) + IA que responde (25/10). */
@Module({
  imports: [MLModule, ShopeeModule, NotificacoesModule, MullerBotModule, RagModule],
  controllers: [PendenciasController],
  providers: [PendenciasService, VerificadoresService, PendenciasJob, PendenciasIaService],
  exports: [PendenciasService],
})
export class PendenciasModule {}
