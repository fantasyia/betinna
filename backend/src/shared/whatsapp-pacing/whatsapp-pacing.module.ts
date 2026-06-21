import { Global, Module } from '@nestjs/common';
import { WhatsappPacingService } from './whatsapp-pacing.service';

/** Global: o gate de pacing é injetável em qualquer ponto de envio (fluxo/campanha/bot). */
@Global()
@Module({
  providers: [WhatsappPacingService],
  exports: [WhatsappPacingService],
})
export class WhatsappPacingModule {}
