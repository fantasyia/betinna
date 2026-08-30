import { Module } from '@nestjs/common';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { TinyClientService } from './tiny-client.service';
import { TinyContaService } from './tiny-conta.service';
import { TinyProdutosService } from './tiny-produtos.service';
import { TinyPedidosService } from './tiny-pedidos.service';
import { TinyOrcamentosService } from './tiny-orcamentos.service';
import { TinyContatosService } from './tiny-contatos.service';
import { TinyRepsSyncService } from './tiny-reps-sync.service';
import { TinyClientesSyncService } from './tiny-clientes-sync.service';
import { TinyContasService } from './tiny-contas.service';
import { TinyPedidoPushService } from './tiny-pedido-push.service';
import { TinyProdutosSyncService } from './tiny-produtos-sync.service';
import { TinyOAuthController } from './tiny-oauth.controller';
import { TinyOAuthService } from './tiny-oauth.service';
import { TinyTokenRefreshJob } from './tiny-token-refresh.job';
import { TinyWebhookController } from './tiny-webhook.controller';
import { TinyMapeamentoService } from './tiny-mapeamento.service';
import { TinyWebhookProcessorService } from './tiny-webhook-processor.service';

/**
 * Integração com o Tiny (Olist) — o ERP a partir de 26/08/2026 (D50).
 *
 * Estado: OAuth + cliente HTTP + receptor de webhook. Os syncs (produtos,
 * estoque, contatos), o push de pedido e o processamento dos eventos são os
 * itens 4–7 do plano em `docs/erp-tiny-olist.md`.
 */
@Module({
  imports: [IntegracoesModule, NotificacoesModule],
  controllers: [TinyOAuthController, TinyWebhookController],
  providers: [
    TinyMapeamentoService,
    TinyOAuthService,
    TinyClientService,
    TinyContaService,
    TinyProdutosService,
    TinyPedidosService,
    TinyOrcamentosService,
    TinyContatosService,
    TinyRepsSyncService,
    TinyClientesSyncService,
    TinyContasService,
    TinyWebhookProcessorService,
    TinyPedidoPushService,
    TinyProdutosSyncService,
    TinyTokenRefreshJob,
  ],
  exports: [
    TinyOAuthService,
    TinyClientService,
    TinyContaService,
    TinyProdutosService,
    TinyPedidosService,
    TinyOrcamentosService,
    TinyContatosService,
    TinyRepsSyncService,
    TinyClientesSyncService,
    TinyContasService,
    TinyWebhookProcessorService,
    TinyPedidoPushService,
    TinyProdutosSyncService,
  ],
})
export class TinyModule {}
