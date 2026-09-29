import { Global, Module, forwardRef } from '@nestjs/common';
import { MetaModule } from '@integrations/meta/meta.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { CanalAdapterRegistry } from './canal-adapter.registry';
import { ConversationNotasService } from './conversation-notas.service';
import { ConversationPresencaService } from './conversation-presenca.service';
import { InboxEventsService } from './inbox-events.service';
import { InboxMetricasService } from './inbox-metricas.service';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { ConversaEsquecidaJob } from './conversa-esquecida.job';
import { MetaGraphModule } from '@integrations/meta/meta-graph.module';

/**
 * InboxModule é `@Global` porque adapters de canal (em outros módulos)
 * precisam injetar `InboxService` + `CanalAdapterRegistry` pra plugar.
 *
 * Importa WhatsAppModule + MetaModule via forwardRef pra disponibilizar
 * MediaServices no controller (signed URLs por canal). Esses módulos
 * dependem de InboxService — daí a referência circular resolvida por forwardRef.
 */
@Global()
@Module({
  imports: [
    forwardRef(() => WhatsAppModule),
    forwardRef(() => MetaModule),
    NotificacoesModule,
    // Nome da campanha do Click-to-WhatsApp pelo sourceId (29/09) — módulo
    // leve, sem o ciclo do MetaModule.
    MetaGraphModule,
  ],
  controllers: [InboxController],
  providers: [
    InboxService,
    CanalAdapterRegistry,
    ConversationNotasService,
    ConversationPresencaService,
    InboxMetricasService,
    InboxEventsService,
    // Varredura de conversa esquecida (card 🔔). O @Cron já é gateado pela
    // ausência do ScheduleModule na api — mesmo padrão do FluxoTriggersJob.
    ConversaEsquecidaJob,
  ],
  exports: [InboxService, CanalAdapterRegistry, InboxEventsService],
})
export class InboxModule {}
