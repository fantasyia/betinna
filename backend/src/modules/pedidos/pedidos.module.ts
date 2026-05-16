import { Module } from '@nestjs/common';
import { OmieModule } from '@integrations/omie/omie.module';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { AprovacoesController } from './aprovacoes.controller';
import { AprovacoesService } from './aprovacoes.service';
import { PedidoPricingService } from './pedido-pricing.service';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';

@Module({
  imports: [ProdutosModule, OmieModule, FluxosModule],
  controllers: [PedidosController, AprovacoesController],
  providers: [PedidosService, AprovacoesService, PedidoPricingService],
  exports: [PedidosService, AprovacoesService, PedidoPricingService],
})
export class PedidosModule {}
