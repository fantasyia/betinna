import { Module } from '@nestjs/common';
import { SheinClientService } from './shein.client';
import { SheinController } from './shein.controller';
import { SheinHistoricoController } from './shein-historico.controller';
import { SheinOAuthService } from './shein-oauth.service';
import { SheinOrdersService } from './shein-orders.service';
import { SheinSyncJob } from './shein-sync.job';

/** Shein (Open API): autorização da loja + pedidos no Vendas marketplaces (01/11). */
@Module({
  controllers: [SheinController, SheinHistoricoController],
  providers: [SheinClientService, SheinOAuthService, SheinOrdersService, SheinSyncJob],
  exports: [SheinClientService, SheinOrdersService],
})
export class SheinModule {}
