import { Module } from '@nestjs/common';
import { TikTokClientService } from './tiktok-client.service';
import { TikTokOAuthController } from './tiktok-oauth.controller';
import { TikTokOAuthService } from './tiktok-oauth.service';
import { TikTokOrdersService } from './tiktok-orders.service';
import { TikTokReturnsService } from './tiktok-returns.service';
import { TikTokService } from './tiktok.service';
import { TikTokSyncJob } from './tiktok-sync.job';
import { TikTokWebhookController } from './tiktok-webhook.controller';

/**
 * Módulo TikTok Shop — Etapa 4/4 dos marketplaces.
 *
 * Cobertura SAC (com restrições inerentes da API TikTok):
 *  - OAuth shop authorization + refresh transparente
 *  - HMAC sandwich em CADA request (TikTokSigner)
 *  - Webhook receiver com HMAC (x-tts-signature)
 *  - Orders: pull + processamento
 *  - Returns/Refunds: search/get/aceitar/rejeitar/anexar evidência
 *  - Adapter Inbox bloqueia envio de texto livre (TikTok não tem chat livre via API)
 *  - Cron 30 min: fallback orders + returns
 *
 * NÃO coberto (limitação da API TikTok, não do código):
 *  - Chat livre comprador↔vendedor (só via Seller Center)
 *  - Reviews: leitura via Reports API assíncrono — fica pra fase futura
 */
@Module({
  controllers: [TikTokOAuthController, TikTokWebhookController],
  providers: [
    TikTokClientService,
    TikTokOAuthService,
    TikTokOrdersService,
    TikTokReturnsService,
    TikTokService,
    TikTokSyncJob,
  ],
  exports: [
    TikTokClientService,
    TikTokOAuthService,
    TikTokOrdersService,
    TikTokReturnsService,
    TikTokService,
    TikTokSyncJob,
  ],
})
export class TikTokModule {}
