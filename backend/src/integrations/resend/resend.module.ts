import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@shared/http/http.module';
import { ResendService } from './resend.service';
import { ResendWebhookService } from './resend-webhook.service';
import { ResendWebhookController } from './resend-webhook.controller';

/**
 * ResendModule — provider de e-mail transacional ÚNICO do sistema.
 * Global pra que TransactionalEmailService (do EmailModule) e os processors
 * (campanhas, dead-letter, fluxos) injetem `ResendService` sem import circular.
 */
@Global()
@Module({
  imports: [HttpModule],
  controllers: [ResendWebhookController],
  providers: [ResendService, ResendWebhookService],
  exports: [ResendService, ResendWebhookService],
})
export class ResendModule {}
