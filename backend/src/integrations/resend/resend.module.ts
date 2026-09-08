import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@shared/http/http.module';
import { ResendService } from './resend.service';
import { ResendWebhookService } from './resend-webhook.service';
import { EmailModule } from '@integrations/email/email.module';
import { ResendWebhookController } from './resend-webhook.controller';

/**
 * ResendModule — provider de e-mail transacional ÚNICO do sistema.
 * Global pra que TransactionalEmailService (do EmailModule) e os processors
 * (campanhas, dead-letter, fluxos) injetem `ResendService` sem import circular.
 */
@Global()
@Module({
  // EmailModule pelo `EmailInboundService`: e-mail RECEBIDO chega no mesmo
  // webhook do Resend. Sem ciclo — o EmailModule pega o ResendService pelo
  // @Global deste módulo, não por import.
  imports: [HttpModule, EmailModule],
  controllers: [ResendWebhookController],
  providers: [ResendService, ResendWebhookService],
  exports: [ResendService, ResendWebhookService],
})
export class ResendModule {}
