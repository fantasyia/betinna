import { Module } from '@nestjs/common';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { EmailModule } from '@integrations/email/email.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { AprovacoesController } from './aprovacoes.controller';
import { AprovacoesService } from './aprovacoes.service';
import { PedidoComissoesService } from './pedido-comissoes.service';
import { PedidoPricingService } from './pedido-pricing.service';
import { PedidoSiteService } from './pedido-site.service';
import { PedidoStatusBotModule } from './pedido-status-bot.module';
import { SiteStatusService } from './site-status.service';
import { PedidoSiteController } from './pedido-site.controller';
import { LeadsModule } from '@modules/leads/leads.module';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { PedidoErpSyncService } from './pedido-erp-sync.service';
import { ComissoesModule } from '@modules/comissoes/comissoes.module';
import { ErpCancelamentosService } from './erp-cancelamentos.service';
import { PedidoFinanceiroErpService } from './pedido-financeiro-erp.service';
import { ErpSyncDiarioJob } from './erp-sync-diario.job';
import { ErpWebhooksJob } from './erp-webhooks.job';

@Module({
  imports: [
    ProdutosModule,
    TinyModule,
    FluxosModule,
    NotificacoesModule,
    EmailModule,
    // O receptor do checkout usa a MESMA chave de API do formulário de leads.
    LeadsModule,
    PedidoStatusBotModule,
    // A passada de cancelamentos reprocessa a folha do mês.
    ComissoesModule,
  ],
  controllers: [PedidosController, AprovacoesController, PedidoSiteController],
  providers: [
    PedidosService,
    AprovacoesService,
    PedidoPricingService,
    PedidoComissoesService,
    PedidoErpSyncService,
    ErpSyncDiarioJob,
    ErpCancelamentosService,
    PedidoFinanceiroErpService,
    ErpWebhooksJob,
    PedidoSiteService,
    SiteStatusService,
  ],
  exports: [
    PedidosService,
    AprovacoesService,
    PedidoPricingService,
    PedidoErpSyncService,
    // O aceite da proposta também cria pedido — a comissão nasce lá junto.
    PedidoComissoesService,
  ],
})
export class PedidosModule {}
