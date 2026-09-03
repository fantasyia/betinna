import { Global, Module } from '@nestjs/common';
import { ClickSignService } from './clicksign.service';

/**
 * Assinatura eletrônica de contrato. Global porque quem dispara é o aceite da
 * proposta, e amanhã pode ser outro ponto (renovação, aditivo).
 */
@Global()
@Module({
  providers: [ClickSignService],
  exports: [ClickSignService],
})
export class ClickSignModule {}
