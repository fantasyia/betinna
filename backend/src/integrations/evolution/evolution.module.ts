import { Module } from '@nestjs/common';
import { EvolutionService } from './evolution.service';

/**
 * Client do Evolution API (só HTTP — sem dependência do WhatsApp/Baileys, pra o
 * facade poder injetar sem ciclo de módulo). O webhook de entrada fica no
 * EvolutionWebhookModule (que importa WhatsApp + Inbox).
 */
@Module({
  providers: [EvolutionService],
  exports: [EvolutionService],
})
export class EvolutionModule {}
