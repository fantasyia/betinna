import { Module } from '@nestjs/common';
import { InboxModule } from '@modules/inbox/inbox.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { EvolutionModule } from './evolution.module';
import { EvolutionInboundService } from './evolution-inbound.service';
import { EvolutionWebhookController } from './evolution-webhook.controller';

/**
 * Webhook de entrada do Evolution. Importa WhatsApp (parser) + Inbox + o client.
 * É o lado que RECEBE — o envio é roteado pelo facade (WhatsAppService).
 */
@Module({
  imports: [EvolutionModule, InboxModule, WhatsAppModule],
  controllers: [EvolutionWebhookController],
  providers: [EvolutionInboundService],
  exports: [EvolutionInboundService],
})
export class EvolutionWebhookModule {}
