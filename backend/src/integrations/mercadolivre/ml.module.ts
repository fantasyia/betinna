import { Module } from '@nestjs/common';
import { MLClaimsService } from './ml-claims.service';
import { MLClientService } from './ml-client.service';
import { MLMessagesService } from './ml-messages.service';
import { MLOAuthController } from './ml-oauth.controller';
import { MLOAuthService } from './ml-oauth.service';
import { MLOrdersService } from './ml-orders.service';
import { MLQuestionsService } from './ml-questions.service';
import { MLService } from './ml.service';
import { MLSyncJob } from './ml-sync.job';
import { MLWebhookController } from './ml-webhook.controller';

/**
 * Módulo Mercado Livre — cobertura completa de SAC:
 *  - OAuth + refresh
 *  - Webhook receiver multi-topic (questions, messages, orders, claims)
 *  - Perguntas pré-venda (responder)
 *  - Chat pós-venda (packs)
 *  - Reclamações (claims + chat interno)
 *  - Mediações (mesmo modelo, status diferente)
 *  - Devoluções (claim type=return)
 *  - Pedidos (sync básico em MarketplaceOrder)
 *  - Adapter Inbox: roteia envios pelo tipo (pergunta/pack/claim)
 *  - Cron 30min: fallback caso webhook falhe
 */
@Module({
  controllers: [MLOAuthController, MLWebhookController],
  providers: [
    MLClientService,
    MLOAuthService,
    MLQuestionsService,
    MLMessagesService,
    MLClaimsService,
    MLOrdersService,
    MLService,
    MLSyncJob,
  ],
  exports: [
    MLClientService,
    MLOAuthService,
    MLQuestionsService,
    MLMessagesService,
    MLClaimsService,
    MLOrdersService,
    MLService,
    MLSyncJob,
  ],
})
export class MLModule {}
