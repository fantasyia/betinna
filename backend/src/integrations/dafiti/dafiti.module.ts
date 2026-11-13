import { Module } from '@nestjs/common';
import { DafitiAnunciosController } from './dafiti-anuncios.controller';
import { DafitiApiController } from './dafiti-api.controller';
import { DafitiClientService } from './dafiti.client';
import { DafitiConsultaController } from './dafiti-consulta.controller';
import { DafitiOrdersService } from './dafiti-orders.service';
import { DafitiSyncJob } from './dafiti-sync.job';

/** Dafiti (Seller Center API v2): pedidos de venda no app (25/10) e consultas de leitura (02/11). */
@Module({
  controllers: [DafitiConsultaController, DafitiAnunciosController, DafitiApiController],
  providers: [DafitiClientService, DafitiOrdersService, DafitiSyncJob],
  exports: [DafitiClientService, DafitiOrdersService],
})
export class DafitiModule {}
