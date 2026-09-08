import { Module } from '@nestjs/common';
import { EmailInboundController } from './email-inbound.controller';
import { EmailInboundService } from './email-inbound.service';
import { TransactionalEmailService } from './transactional-email.service';

/**
 * EmailModule — fachada de e-mail transacional do sistema.
 *
 * Provê o `TransactionalEmailService` (saída, via Resend) e o
 * `EmailInboundService` (ENTRADA: a resposta do lead virando evento).
 *
 * O de saída envia via Resend
 * (provedor sistêmico único — `ResendModule` é @Global, então o service injeta
 * `ResendService` sem precisar importar aqui).
 */
@Module({
  controllers: [EmailInboundController],
  providers: [TransactionalEmailService, EmailInboundService],
  exports: [TransactionalEmailService, EmailInboundService],
})
export class EmailModule {}
