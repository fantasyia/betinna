import { Module } from '@nestjs/common';
import { InboxInternaController } from './inbox-interna.controller';
import { InboxInternaService } from './inbox-interna.service';

@Module({
  controllers: [InboxInternaController],
  providers: [InboxInternaService],
  exports: [InboxInternaService],
})
export class InboxInternaModule {}
