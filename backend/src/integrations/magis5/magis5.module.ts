import { Module } from '@nestjs/common';
import { Magis5ClientService } from './magis5.client';
import { Magis5Controller } from './magis5.controller';
import { Magis5OrdersService } from './magis5-orders.service';
import { Magis5SyncJob } from './magis5-sync.job';

/** Magis5: leitura de pedidos (Fase 1, 03/11). Nada escreve no Magis5. */
@Module({
  controllers: [Magis5Controller],
  providers: [Magis5ClientService, Magis5OrdersService, Magis5SyncJob],
  exports: [Magis5ClientService, Magis5OrdersService],
})
export class Magis5Module {}
