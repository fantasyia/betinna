import { Module } from '@nestjs/common';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadCaptureController } from './lead-capture.controller';
import { LeadCaptureService } from './lead-capture.service';

@Module({
  imports: [FluxosModule],
  controllers: [LeadsController, LeadCaptureController],
  providers: [LeadsService, LeadCaptureService],
  // LeadCaptureService sai porque o receptor de PEDIDOS do site usa a MESMA
  // chave de API — duas chaves pro mesmo site seriam duas coisas pra girar.
  exports: [LeadsService, LeadCaptureService],
})
export class LeadsModule {}
