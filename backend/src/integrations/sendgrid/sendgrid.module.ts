import { Module } from '@nestjs/common';
import { SendGridController } from './sendgrid.controller';
import { SendGridService } from './sendgrid.service';
import { TransactionalEmailService } from './transactional-email.service';

@Module({
  controllers: [SendGridController],
  providers: [SendGridService, TransactionalEmailService],
  exports: [SendGridService, TransactionalEmailService],
})
export class SendGridModule {}
