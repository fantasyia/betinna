import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { WhatsAppModule } from '@integrations/whatsapp/whatsapp.module';
import { IntegracoesModule } from '@modules/integracoes/integracoes.module';
import { CampanhaEnvioProcessor } from './campanha-envio.processor';
import { CAMPANHA_ENVIO_QUEUE } from './campanha-envio.types';
import { CampanhaIaService } from './campanha-ia.service';
import { CampanhaSchedulerJob } from './campanha-scheduler.job';
import { CampanhasController } from './campanhas.controller';
import { CampanhasService } from './campanhas.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: CAMPANHA_ENVIO_QUEUE }),
    WhatsAppModule,
    SendGridModule,
    IntegracoesModule, // expõe UsuarioIntegracoesService para CampanhaIaService
  ],
  controllers: [CampanhasController],
  providers: [
    CampanhasService,
    CampanhaIaService,
    CampanhaEnvioProcessor,
    CampanhaSchedulerJob,
  ],
  exports: [CampanhasService, CampanhaIaService],
})
export class CampanhasModule {}
