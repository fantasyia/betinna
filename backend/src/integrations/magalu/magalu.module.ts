import { Module } from '@nestjs/common';
import { MagaluApiController } from './magalu-api.controller';
import { MagaluClientService } from './magalu-client.service';
import { MagaluOAuthController } from './magalu-oauth.controller';
import { MagaluOAuthService } from './magalu-oauth.service';
import { MagaluOrdersService } from './magalu-orders.service';
import { MagaluSacService } from './magalu-sac.service';
import { MagaluSyncJob } from './magalu-sync.job';

/**
 * Magalu (Open API + ID Magalu, 14/11): OAuth + refresh, `magalu_api`
 * (ler livre; escrever só SKU/preço, sem estoque), pedidos → MarketplaceOrder
 * e SAC (tickets) → incidentes, a cada 30 min.
 */
@Module({
  controllers: [MagaluOAuthController, MagaluApiController],
  providers: [
    MagaluOAuthService,
    MagaluClientService,
    MagaluOrdersService,
    MagaluSacService,
    MagaluSyncJob,
  ],
  exports: [MagaluClientService, MagaluOrdersService],
})
export class MagaluModule {}
