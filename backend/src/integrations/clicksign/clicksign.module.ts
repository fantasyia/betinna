import { Global, Module } from '@nestjs/common';
import { ComissoesModule } from '@modules/comissoes/comissoes.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { PropostasModule } from '@modules/propostas/propostas.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { ClickSignAssinaturaService } from './clicksign-assinatura.service';
import { ClickSignWebhookController } from './clicksign-webhook.controller';
import { ClickSignService } from './clicksign.service';

/**
 * Assinatura eletrônica de contrato. Global porque quem dispara é o aceite da
 * proposta, e amanhã pode ser outro ponto (renovação, aditivo).
 *
 * O retorno vem por webhook, não por varredura: a ClickSign **proíbe polling**
 * em documentos. Por isso o controller mora aqui junto — ida e volta são o
 * mesmo assunto.
 */
@Global()
@Module({
  imports: [ComissoesModule, NotificacoesModule, LeadsModule, PropostasModule],
  controllers: [ClickSignWebhookController],
  providers: [ClickSignService, ClickSignAssinaturaService],
  exports: [ClickSignService],
})
export class ClickSignModule {}
