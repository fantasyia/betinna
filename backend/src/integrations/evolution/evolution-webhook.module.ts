import { Module } from '@nestjs/common';
import { InboxModule } from '@modules/inbox/inbox.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { EvolutionModule } from './evolution.module';
import { EvolutionInboundService } from './evolution-inbound.service';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { EvolutionInstanciasSyncJob } from './evolution-instancias-sync.job';
import { EvolutionSyncJob } from './evolution-sync.job';

/**
 * Webhook de entrada do Evolution. Importa WhatsApp (parser) + Inbox + o client.
 * É o lado que RECEBE — o envio é roteado pelo facade (WhatsAppService).
 * Inclui o poll de fallback de mensagens (EvolutionSyncJob) + o sync de estado das
 * instâncias na tabela EvolutionInstancia (EvolutionInstanciasSyncJob).
 */
@Module({
  imports: [EvolutionModule, InboxModule, WhatsAppModule],
  controllers: [EvolutionWebhookController],
  providers: [EvolutionInboundService, EvolutionSyncJob, EvolutionInstanciasSyncJob],
  exports: [EvolutionInboundService],
})
export class EvolutionWebhookModule {}
