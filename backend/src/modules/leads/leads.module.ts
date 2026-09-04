import { Module } from '@nestjs/common';
import { FluxosModule } from '@modules/fluxos/fluxos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadCaptureController } from './lead-capture.controller';
import { LeadCaptureService } from './lead-capture.service';
import { LeadEtapaSistemaService } from './lead-etapa-sistema.service';

@Module({
  imports: [FluxosModule, NotificacoesModule],
  controllers: [LeadsController, LeadCaptureController],
  providers: [LeadsService, LeadCaptureService, LeadEtapaSistemaService],
  // LeadCaptureService sai porque o receptor de PEDIDOS do site usa a MESMA
  // chave de API — duas chaves pro mesmo site seriam duas coisas pra girar.
  // LeadEtapaSistemaService sai porque quem sabe dos marcos são propostas,
  // assinatura eletrônica e ERP — cada um no seu módulo.
  exports: [LeadsService, LeadCaptureService, LeadEtapaSistemaService],
})
export class LeadsModule {}
