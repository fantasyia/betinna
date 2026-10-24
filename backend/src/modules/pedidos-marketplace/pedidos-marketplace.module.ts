import { Module } from '@nestjs/common';
import { PedidosMarketplaceController } from './pedidos-marketplace.controller';
import { PedidosMarketplaceService } from './pedidos-marketplace.service';

/** Pedidos de venda dos marketplaces com lucro, 1 por 1 (24/10). */
@Module({
  controllers: [PedidosMarketplaceController],
  providers: [PedidosMarketplaceService],
})
export class PedidosMarketplaceModule {}
