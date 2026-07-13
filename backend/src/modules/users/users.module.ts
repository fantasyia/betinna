import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { EvolutionModule } from '@integrations/evolution/evolution.module';
import { KanbanModule } from '@modules/kanban/kanban.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [EmailModule, EvolutionModule, KanbanModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
