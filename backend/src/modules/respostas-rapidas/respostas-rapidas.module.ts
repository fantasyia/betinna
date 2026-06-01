import { Module } from '@nestjs/common';
import { RespostasRapidasController } from './respostas-rapidas.controller';
import { RespostasRapidasService } from './respostas-rapidas.service';

/** Sprint 2.3 — Respostas rápidas / templates da Inbox. */
@Module({
  controllers: [RespostasRapidasController],
  providers: [RespostasRapidasService],
  exports: [RespostasRapidasService],
})
export class RespostasRapidasModule {}
