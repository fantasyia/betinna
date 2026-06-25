import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { EmailModule } from '@integrations/email/email.module';
import { HttpModule } from '@shared/http/http.module';
import { RODAR_BACKGROUND } from '@shared/utils/service-type';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { RagModule } from '@modules/rag/rag.module';
import { FluxoEventBusService } from './fluxo-event-bus.service';
import { FluxoExecutorProcessor } from './fluxo-executor.processor';
import { FluxoExecutorService } from './fluxo-executor.service';
import { FluxoTriggersJob } from './fluxo-triggers.job';
import { CronMetricsService } from './cron-metrics.service';
import { FluxosController } from './fluxos.controller';
import { FluxosService } from './fluxos.service';
import { OrquestracaoLeadEventsService } from './orquestracao-lead-events.service';
import { ConversarIaService } from './conversar-ia.service';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';
import { WebhookEntradaController } from './webhook-entrada.controller';
import { WebhookEntradaService } from './webhook-entrada.service';
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
    // RAG — busca de conhecimento (catálogo via ProdutoSearch do MullerBot).
    RagModule,
  ],
  controllers: [FluxosController, MonitorController, WebhookEntradaController],
  providers: [
    FluxosService,
    FluxoEventBusService,
    FluxoExecutorService,
    // Processor (consumidor BullMQ) só no worker em produção; FluxoTriggersJob fica registrado
    // (seu @Cron já é gateado pela ausência do ScheduleModule na api).
    ...(RODAR_BACKGROUND ? [FluxoExecutorProcessor] : []),
    FluxoTriggersJob,
    CronMetricsService,
    OrquestracaoLeadEventsService,
    ConversarIaService,
    MonitorService,
    WebhookEntradaService,
  ],
  exports: [FluxoEventBusService],
})
export class FluxosModule {}
