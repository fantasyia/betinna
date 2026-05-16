import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CAMPANHA_ENVIO_QUEUE } from '@modules/campanhas/campanha-envio.types';
import { FLUXO_QUEUE } from '@modules/fluxos/fluxo-executor.types';
import { DEAD_LETTER_QUEUE } from '@modules/dead-letter/dead-letter.types';
import { HealthController } from './health.controller';
import { VersionController } from './version.controller';

@Module({
  imports: [
    // Health check precisa injetar as queues pra inspect status
    BullModule.registerQueue(
      { name: CAMPANHA_ENVIO_QUEUE },
      { name: FLUXO_QUEUE },
      { name: DEAD_LETTER_QUEUE },
    ),
  ],
  // Sprint 5 FIX 7 — VersionController exposing GET /version
  controllers: [HealthController, VersionController],
})
export class HealthModule {}
