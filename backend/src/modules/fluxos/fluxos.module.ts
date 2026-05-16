import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { HttpModule } from '@shared/http/http.module';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { FluxoExecutorProcessor } from './fluxo-executor.processor';
import { FluxoExecutorService } from './fluxo-executor.service';
import { FluxoTriggersJob } from './fluxo-triggers.job';
import { FluxosController } from './fluxos.controller';
import { FluxosService } from './fluxos.service';
import { FLUXO_QUEUE } from './fluxo-executor.types';

@Module({
  imports: [
    // Registra a fila BullMQ pra este módulo
    BullModule.registerQueue({ name: FLUXO_QUEUE }),
    // Integrações usadas pelo executor
    WhatsAppModule,
    SendGridModule,
    HttpModule,
  ],
  controllers: [FluxosController],
  providers: [
    FluxosService,
    FluxoEventBusService,
    FluxoExecutorService,
    FluxoExecutorProcessor,
    FluxoTriggersJob,
  ],
  exports: [FluxoEventBusService],
})
export class FluxosModule {}
