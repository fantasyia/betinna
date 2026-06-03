import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { EmailModule } from '@integrations/email/email.module';
import { HttpModule } from '@shared/http/http.module';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { FluxoExecutorProcessor } from './fluxo-executor.processor';
import { FluxoExecutorService } from './fluxo-executor.service';
import { FluxoTriggersJob } from './fluxo-triggers.job';
import { FluxosController } from './fluxos.controller';
import { FluxosService } from './fluxos.service';
import { OrquestracaoLeadEventsService } from './orquestracao-lead-events.service';
import { ConversarIaService } from './conversar-ia.service';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { FLUXO_QUEUE } from './fluxo-executor.types';

@Module({
  imports: [
    // Registra a fila BullMQ pra este módulo
    BullModule.registerQueue({ name: FLUXO_QUEUE }),
    // Integrações usadas pelo executor (e-mail transacional pro FluxoTriggersJob)
    WhatsAppModule,
    EmailModule,
    HttpModule,
    // Orquestração (Fase B) — nó "Conversar com IA" usa OpenAI + persona do MullerBot.
    MullerBotModule,
  ],
  controllers: [FluxosController, MonitorController],
  providers: [
    FluxosService,
    FluxoEventBusService,
    FluxoExecutorService,
    FluxoExecutorProcessor,
    FluxoTriggersJob,
    OrquestracaoLeadEventsService,
    ConversarIaService,
    MonitorService,
  ],
  exports: [FluxoEventBusService],
})
export class FluxosModule {}
