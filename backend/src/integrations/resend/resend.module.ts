import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@shared/http/http.module';
import { ResendService } from './resend.service';

/**
 * ResendModule — provider de e-mail transacional alternativo ao SendGrid.
 * Global pra que TransactionalEmailService (do SendGridModule) injete sem
 * precisar de import circular.
 */
@Global()
@Module({
  imports: [HttpModule],
  providers: [ResendService],
  exports: [ResendService],
})
export class ResendModule {}
