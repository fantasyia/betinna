import { Module } from '@nestjs/common';
import { ComissoesModule } from '@modules/comissoes/comissoes.module';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { ContratoComodatoService } from './contrato-comodato.service';
import { ContratoMensalidadeSyncService } from './contrato-mensalidade-sync.service';

/** Leitura dos contratos de locação — quem os cria é o aceite da proposta. */
@Module({
  imports: [ComissoesModule],
  controllers: [ContratosController],
  providers: [ContratosService, ContratoComodatoService, ContratoMensalidadeSyncService],
  exports: [ContratosService, ContratoComodatoService, ContratoMensalidadeSyncService],
})
export class ContratosModule {}
