import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { EvolutionModule } from '@integrations/evolution/evolution.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [EmailModule, EvolutionModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
