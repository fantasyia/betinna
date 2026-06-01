import { Module } from '@nestjs/common';
import { TransactionalEmailService } from './transactional-email.service';

/**
 * EmailModule — fachada de e-mail transacional do sistema.
 *
 * Provê e exporta apenas o `TransactionalEmailService`, que envia via Resend
 * (provedor sistêmico único — `ResendModule` é @Global, então o service injeta
 * `ResendService` sem precisar importar aqui).
 */
@Module({
  providers: [TransactionalEmailService],
  exports: [TransactionalEmailService],
})
export class EmailModule {}
