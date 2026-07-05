import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailModule } from '@integrations/email/email.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { MullerBotModule } from '@modules/mullerbot/mullerbot.module';
import { CampanhaEnvioProcessor } from './campanha-envio.processor';
import { CAMPANHA_ENVIO_QUEUE } from './campanha-envio.types';
import { CampanhaIaService } from './campanha-ia.service';
import { CampanhaSchedulerJob } from './campanha-scheduler.job';
import { CampanhasController } from './campanhas.controller';
import { CampanhasService } from './campanhas.service';
import { CampanhaTemplateController } from './campanha-template.controller';
import { CampanhaTemplateService } from './campanha-template.service';
import { RODAR_BACKGROUND } from '@shared/utils/service-type';

@Module({
  imports: [
    BullModule.registerQueue({ name: CAMPANHA_ENVIO_QUEUE }),
    WhatsAppModule,
    EmailModule, // fachada TransactionalEmailService (e-mail da campanha)
    IntegracoesModule, // expõe UsuarioIntegracoesService para CampanhaIaService
    MullerBotModule, // expõe BotCustoService (teto de custo de LLM da campanha IA)
  ],
  // CampanhaTemplateController usa path top-level 'campanha-templates' (fora de
  // /campanhas/:id), então não há colisão de rota — a ordem aqui é indiferente.
  controllers: [CampanhasController, CampanhaTemplateController],
  // O Processor (consumidor BullMQ) só roda no worker em produção; o resto (service/scheduler)
  // segue registrado (o @Cron do scheduler já é gateado pela ausência do ScheduleModule na api).
  providers: [
    CampanhasService,
    CampanhaTemplateService,
    CampanhaIaService,
    CampanhaSchedulerJob,
    ...(RODAR_BACKGROUND ? [CampanhaEnvioProcessor] : []),
  ],
  exports: [CampanhasService, CampanhaIaService],
})
export class CampanhasModule {}
