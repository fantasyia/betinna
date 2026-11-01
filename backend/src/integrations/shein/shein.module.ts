import { Module } from '@nestjs/common';
import { SheinClientService } from './shein.client';
import { SheinController } from './shein.controller';
import { SheinHistoricoController } from './shein-historico.controller';
import { SheinOAuthService } from './shein-oauth.service';
import { SheinOrdersService } from './shein-orders.service';
import { SheinPosVendaService } from './shein-pos-venda.service';
import { SheinSyncJob } from './shein-sync.job';

/** Shein (Open API): autorização da loja, pedidos no Vendas marketplaces e pós-venda em Incidentes (01/11). */
@Module({
  controllers: [SheinController, SheinHistoricoController],
  providers: [
    SheinClientService,
    SheinOAuthService,
    SheinOrdersService,
    SheinPosVendaService,
    SheinSyncJob,
  ],
  exports: [SheinClientService, SheinOrdersService],
})
export class SheinModule {}
