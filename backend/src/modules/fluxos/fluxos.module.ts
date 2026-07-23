import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { EmailModule } from '@integrations/email/email.module';
import { HttpModule } from '@shared/http/http.module';
import { RODAR_BACKGROUND } from '@shared/utils/service-type';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { RagModule } from '@modules/rag/rag.module';
import { KanbanModule } from '@modules/kanban/kanban.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
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
import { CAMPANHA_ENVIO_QUEUE } from '@modules/campanhas/campanha-envio.types';
import { DEAD_LETTER_QUEUE } from '@modules/dead-letter/dead-letter.types';

@Module({
  imports: [
    // Registra a fila BullMQ pra este módulo. As filas de campanha e dead-letter
    // entram SÓ pra leitura de contadores no painel de fila (MonitorService.filas)
    // — os producers/consumers delas vivem nos módulos donos.
    BullModule.registerQueue(
      { name: FLUXO_QUEUE },
      { name: CAMPANHA_ENVIO_QUEUE },
      { name: DEAD_LETTER_QUEUE },
    ),
    // Integrações usadas pelo executor (e-mail transacional pro FluxoTriggersJob)
    WhatsAppModule,
    EmailModule,
    HttpModule,
    // Orquestração (Fase B) — nó "Conversar com IA" usa OpenAI + persona do MullerBot.
    MullerBotModule,
    // RAG — busca de conhecimento (catálogo via ProdutoSearch do MullerBot).
    RagModule,
    // CRIAR_TAREFA → card Kanban (quadro do rep + espelho no Diretor).
    KanbanModule,
    // TRANSFERIR_ATENDIMENTO → notifica o agente/SAC ao passar a conversa.
    NotificacoesModule,
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
