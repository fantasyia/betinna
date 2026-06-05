import { Module } from '@nestjs/common';
import { EvolutionModule } from '@integrations/evolution/evolution.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppUsuarioController } from './whatsapp-usuario.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppMediaService } from './whatsapp-media.service';

@Module({
  imports: [EvolutionModule],
  controllers: [WhatsAppController, WhatsAppUsuarioController],
  providers: [WhatsAppSessionService, WhatsAppService, WhatsAppMediaService],
  exports: [WhatsAppSessionService, WhatsAppService, WhatsAppMediaService],
})
export class WhatsAppModule {}
