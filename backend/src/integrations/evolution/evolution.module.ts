import { Module } from '@nestjs/common';
import { EvolutionInstanciaService } from './evolution-instancia.service';
import { EvolutionService } from './evolution.service';

/**
 * Client do Evolution API (só HTTP — sem dependência do WhatsApp/Baileys, pra o
 * facade poder injetar sem ciclo de módulo). O webhook de entrada fica no
 * EvolutionWebhookModule (que importa WhatsApp + Inbox).
 *
 * `EvolutionInstanciaService` persiste o estado das instâncias (tabela durável) — usado pelo
 * webhook hoje e pelos controllers/sync (connect/delete) no futuro.
 */
@Module({
  providers: [EvolutionService, EvolutionInstanciaService],
  exports: [EvolutionService, EvolutionInstanciaService],
})
export class EvolutionModule {}
