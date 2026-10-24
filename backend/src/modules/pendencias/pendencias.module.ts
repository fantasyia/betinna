import { Module } from '@nestjs/common';
import { MLModule } from '@integrations/mercadolivre/ml.module';
import { ShopeeModule } from '@integrations/shopee/shopee.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { PendenciasController } from './pendencias.controller';
import { PendenciasJob } from './pendencias.job';
import { PendenciasService } from './pendencias.service';
import { VerificadoresService } from './verificadores.service';

/** Pendências de marketplace + rotina de hora em hora (24/10). */
@Module({
  imports: [MLModule, ShopeeModule, NotificacoesModule],
  controllers: [PendenciasController],
  providers: [PendenciasService, VerificadoresService, PendenciasJob],
  exports: [PendenciasService],
})
export class PendenciasModule {}
