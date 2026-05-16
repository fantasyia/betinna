import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppUsuarioController } from './whatsapp-usuario.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService } from './whatsapp-session.service';

@Module({
  controllers: [WhatsAppController, WhatsAppUsuarioController],
  providers: [WhatsAppSessionService, WhatsAppService],
  exports: [WhatsAppSessionService, WhatsAppService],
})
export class WhatsAppModule {}
