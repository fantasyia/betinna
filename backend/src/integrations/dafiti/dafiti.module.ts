import { Module } from '@nestjs/common';
import { DafitiClientService } from './dafiti.client';
import { DafitiOrdersService } from './dafiti-orders.service';
import { DafitiSyncJob } from './dafiti-sync.job';

/** Dafiti (Seller Center API v2): pedidos de venda no app (25/10). */
@Module({
  providers: [DafitiClientService, DafitiOrdersService, DafitiSyncJob],
  exports: [DafitiClientService, DafitiOrdersService],
})
export class DafitiModule {}
