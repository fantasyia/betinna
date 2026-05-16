import { Module } from '@nestjs/common';
import { ShopeeChatService } from './shopee-chat.service';
import { ShopeeClientService } from './shopee-client.service';
import { ShopeeOAuthController } from './shopee-oauth.controller';
import { ShopeeOAuthService } from './shopee-oauth.service';
import { ShopeeOrdersService } from './shopee-orders.service';
import { ShopeeReturnsService } from './shopee-returns.service';
import { ShopeeService } from './shopee.service';
import { ShopeeSyncJob } from './shopee-sync.job';
import { ShopeeWebhookController } from './shopee-webhook.controller';

/**
 * Módulo Shopee — Etapa 2/4 dos marketplaces. SAC completo:
 *  - OAuth (shop authorization) + refresh
 *  - HMAC SHA-256 em CADA request (ShopeeSigner)
 *  - Webhook receiver com HMAC do url|body
 *  - Chat direto (sellerchat)
 *  - Returns/Refunds/Disputes → MarketplaceIncident
 *  - Orders → MarketplaceOrder
 *  - Adapter Inbox (roteia conv:|return: peerId)
 *  - Cron 30 min: fallback returns + orders
 */
@Module({
  controllers: [ShopeeOAuthController, ShopeeWebhookController],
  providers: [
    ShopeeClientService,
    ShopeeOAuthService,
    ShopeeChatService,
    ShopeeReturnsService,
    ShopeeOrdersService,
    ShopeeService,
    ShopeeSyncJob,
  ],
  exports: [
    ShopeeClientService,
    ShopeeOAuthService,
    ShopeeChatService,
    ShopeeReturnsService,
    ShopeeOrdersService,
    ShopeeService,
    ShopeeSyncJob,
  ],
})
export class ShopeeModule {}
