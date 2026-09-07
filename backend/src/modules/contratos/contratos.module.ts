import { Module } from '@nestjs/common';
import { ComissoesModule } from '@modules/comissoes/comissoes.module';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { ContratoComodatoService } from './contrato-comodato.service';
import { ContratoErpService } from './contrato-erp.service';
import { ContratoMensalidadeSyncService } from './contrato-mensalidade-sync.service';

/** Leitura dos contratos de locação — quem os cria é o aceite da proposta. */
@Module({
  // TinyModule explícito: o serviço de mensalidade injeta TinyContasService, e
  // módulo importado não reexporta o que ELE importa — o ComissoesModule usar o
  // Tiny não torna o Tiny visível aqui.
  imports: [ComissoesModule, TinyModule],
  controllers: [ContratosController],
  providers: [
    ContratosService,
    ContratoComodatoService,
    ContratoErpService,
    ContratoMensalidadeSyncService,
  ],
  exports: [
    ContratosService,
    ContratoComodatoService,
    ContratoErpService,
    ContratoMensalidadeSyncService,
  ],
})
export class ContratosModule {}
