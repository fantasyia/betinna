import { Module } from '@nestjs/common';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { EmailModule } from '@integrations/email/email.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { AprovacoesController } from './aprovacoes.controller';
import { AprovacoesService } from './aprovacoes.service';
import { PedidoPricingService } from './pedido-pricing.service';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { PedidoErpSyncService } from './pedido-erp-sync.service';
import { ErpSyncDiarioJob } from './erp-sync-diario.job';
import { ErpWebhooksJob } from './erp-webhooks.job';

@Module({
  imports: [ProdutosModule, TinyModule, FluxosModule, NotificacoesModule, EmailModule],
  controllers: [PedidosController, AprovacoesController],
  providers: [
    PedidosService,
    AprovacoesService,
    PedidoPricingService,
    PedidoErpSyncService,
    ErpSyncDiarioJob,
    ErpWebhooksJob,
  ],
  exports: [PedidosService, AprovacoesService, PedidoPricingService, PedidoErpSyncService],
})
export class PedidosModule {}
