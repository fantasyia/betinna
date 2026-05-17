import { Module } from '@nestjs/common';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [SendGridModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
