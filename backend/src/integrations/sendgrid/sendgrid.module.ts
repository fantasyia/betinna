import { Module } from '@nestjs/common';
import { SendGridController } from './sendgrid.controller';
import { SendGridService } from './sendgrid.service';

@Module({
  controllers: [SendGridController],
  providers: [SendGridService],
  exports: [SendGridService],
})
export class SendGridModule {}
