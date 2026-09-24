import { Module } from '@nestjs/common';
import { ComissoesModule } from '@modules/comissoes/comissoes.module';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { ModeloContratoModule } from '@modules/modelo-contrato/modelo-contrato.module';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { ContratoComodatoService } from './contrato-comodato.service';
import { ContratoComodatoErpService } from './contrato-comodato-erp.service';
import { ContratoAprovacaoJob } from './contrato-aprovacao.job';
import { ContratoErpService } from './contrato-erp.service';
import { ContratoEsteiraService } from './contrato-esteira.service';
import { FiscalPendenciasService } from './fiscal-pendencias.service';
import { ContratoMensalidadeSyncService } from './contrato-mensalidade-sync.service';
import { ContratoReenvioService } from './contrato-reenvio.service';

/** Leitura dos contratos de locação — quem os cria é o aceite da proposta. */
@Module({
  // TinyModule explícito: o serviço de mensalidade injeta TinyContasService, e
  // módulo importado não reexporta o que ELE importa — o ComissoesModule usar o
  // Tiny não torna o Tiny visível aqui.
  // ModeloContratoModule: o reenvio sai com o modelo EM USO, igual ao aceite.
  imports: [ComissoesModule, TinyModule, ModeloContratoModule],
  controllers: [ContratosController],
  providers: [
    ContratosService,
    FiscalPendenciasService,
    ContratoComodatoErpService,
    ContratoComodatoService,
    ContratoErpService,
    ContratoEsteiraService,
    ContratoMensalidadeSyncService,
    ContratoReenvioService,
    ContratoAprovacaoJob,
  ],
  exports: [
    ContratosService,
    FiscalPendenciasService,
    ContratoComodatoErpService,
    ContratoComodatoService,
    ContratoErpService,
    ContratoEsteiraService,
    ContratoMensalidadeSyncService,
    ContratoReenvioService,
    ContratoAprovacaoJob,
  ],
})
export class ContratosModule {}
