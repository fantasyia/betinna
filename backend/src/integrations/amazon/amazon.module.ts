import { Module } from '@nestjs/common';
import { AmazonClientService } from './amazon-client.service';
import { AmazonLwaService } from './amazon-lwa.service';
import { AmazonMessagingService } from './amazon-messaging.service';
import { AmazonOAuthController } from './amazon-oauth.controller';
import { AmazonOrdersService } from './amazon-orders.service';
import { AmazonService } from './amazon.service';
import { AmazonSyncJob } from './amazon-sync.job';

/**
 * Módulo Amazon SP-API — Etapa 3/4 dos marketplaces.
 *
 * Cobertura SAC (com as restrições inerentes da API Amazon):
 *  - OAuth Selling Partner (LWA) + refresh transparente
 *  - Pull periódico de Orders (cron 30 min) — Amazon não usa webhook HTTP
 *  - Permitted Actions outbound: confirmDeliveryDetails, confirmOrderDetails,
 *    unexpectedProblem, getCustomerInformation, sendInvoice
 *  - Adapter Inbox roteia texto livre pra ação permitida disponível
 *
 * NÃO coberto (limitação da API Amazon, não do nosso código):
 *  - Chat livre (Amazon não tem endpoint pra isso)
 *  - INBOUND messages do comprador (Amazon não expõe via API)
 *  - A-to-Z Guarantee Claims (só via Seller Central)
 *  - Customer Service Contacts (só via Seller Central)
 *  - SQS Notifications subscriber (fica pra fase futura)
 */
@Module({
  controllers: [AmazonOAuthController],
  providers: [
    AmazonLwaService,
    AmazonClientService,
    AmazonOrdersService,
    AmazonMessagingService,
    AmazonService,
    AmazonSyncJob,
  ],
  exports: [
    AmazonLwaService,
    AmazonClientService,
    AmazonOrdersService,
    AmazonMessagingService,
    AmazonService,
    AmazonSyncJob,
  ],
})
export class AmazonModule {}
