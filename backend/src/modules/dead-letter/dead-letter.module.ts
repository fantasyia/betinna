import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { CAMPANHA_ENVIO_QUEUE } from '@modules/campanhas/campanha-envio.types';
import { FLUXO_QUEUE } from '@modules/fluxos/fluxo-executor.types';
import { DeadLetterController } from './dead-letter.controller';
import { DeadLetterProcessor } from './dead-letter.processor';
import { DeadLetterService } from './dead-letter.service';
import { DEAD_LETTER_QUEUE } from './dead-letter.types';

/**
 * Módulo do Dead Letter Queue (Sprint 3 FIX 3).
 *
 * @Global porque cada queue produtora (CampanhaEnvioProcessor,
 * FluxoExecutorProcessor) precisa injetar `DeadLetterService` no
 * worker.on('failed').
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: DEAD_LETTER_QUEUE },
      // Importamos as filas originais aqui pra que o retry possa empurrar
      // de volta. (Forma robusta — não depende de quem registrou primeiro.)
      { name: CAMPANHA_ENVIO_QUEUE },
      { name: FLUXO_QUEUE },
    ),
    SendGridModule,
  ],
  controllers: [DeadLetterController],
  providers: [DeadLetterService, DeadLetterProcessor],
  exports: [DeadLetterService],
})
export class DeadLetterModule {}
