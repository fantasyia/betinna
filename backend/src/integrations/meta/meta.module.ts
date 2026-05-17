import { Module } from '@nestjs/common';
import { FacebookService } from './facebook.service';
import { InstagramService } from './instagram.service';
import { MetaGraphClientService } from './meta-graph-client.service';
import { MetaMediaService } from './meta-media.service';
import { MetaOAuthController } from './meta-oauth.controller';
import { MetaOAuthService } from './meta-oauth.service';
import { MetaWebhookController } from './meta-webhook.controller';

/**
 * Módulo Meta — Facebook Messenger + Instagram Direct via Graph API.
 *
 * - `MetaGraphClientService`: HTTP wrapper de baixo nível
 * - `MetaOAuthService` + `MetaOAuthController`: Facebook Login + onboarding
 * - `MetaWebhookController`: receiver público (verify GET + receive POST com HMAC)
 * - `FacebookService` / `InstagramService`: adapters que pluguam na Inbox
 *
 * Os dois adapters auto-registram no `CanalAdapterRegistry` no boot.
 */
@Module({
  controllers: [MetaOAuthController, MetaWebhookController],
  providers: [
    MetaGraphClientService,
    MetaOAuthService,
    MetaMediaService,
    FacebookService,
    InstagramService,
  ],
  exports: [
    MetaGraphClientService,
    MetaOAuthService,
    MetaMediaService,
    FacebookService,
    InstagramService,
  ],
})
export class MetaModule {}
