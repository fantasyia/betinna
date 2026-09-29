import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LeadsModule } from '@modules/leads/leads.module';
import { FacebookService } from './facebook.service';
import { InstagramService } from './instagram.service';
import { MetaGraphModule } from './meta-graph.module';
import { MetaLeadgenProcessor } from './meta-leadgen.processor';
import { MetaLeadgenService } from './meta-leadgen.service';
import { META_LEADGEN_QUEUE } from './meta-leadgen.types';
import { MetaMediaService } from './meta-media.service';
import { MetaOAuthController } from './meta-oauth.controller';
import { MetaOAuthService } from './meta-oauth.service';
import { MetaTokenRefreshJob } from './meta-token-refresh.job';
import { MetaWebhookController } from './meta-webhook.controller';

/**
 * Módulo Meta — Facebook Messenger + Instagram Direct via Graph API.
 *
 * - `MetaGraphClientService`: HTTP wrapper de baixo nível
 * - `MetaOAuthService` + `MetaOAuthController`: Facebook Login + onboarding
 * - `MetaWebhookController`: receiver público (verify GET + receive POST com HMAC)
 * - `FacebookService` / `InstagramService`: adapters que pluguam na Inbox
 * - `MetaLeadgenService` + processor: Lead Ads (formulário nativo) — o webhook
 *   só enfileira, a fila busca os dados na Graph API com retry
 *
 * Os dois adapters auto-registram no `CanalAdapterRegistry` no boot.
 */
@Module({
  imports: [BullModule.registerQueue({ name: META_LEADGEN_QUEUE }), LeadsModule, MetaGraphModule],
  controllers: [MetaOAuthController, MetaWebhookController],
  providers: [
    MetaOAuthService,
    MetaMediaService,
    MetaTokenRefreshJob,
    FacebookService,
    InstagramService,
    MetaLeadgenService,
    MetaLeadgenProcessor,
  ],
  exports: [
    MetaGraphModule,
    MetaOAuthService,
    MetaMediaService,
    FacebookService,
    InstagramService,
    MetaLeadgenService,
  ],
})
export class MetaModule {}
