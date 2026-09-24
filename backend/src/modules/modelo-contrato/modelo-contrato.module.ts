import { Module } from '@nestjs/common';
import { ModeloContratoController } from './modelo-contrato.controller';
import { ModeloContratoService } from './modelo-contrato.service';

/**
 * Módulo à parte de propósito: quem usa o modelo EM USO é o aceite (módulo de
 * propostas) e o reenvio (módulo de contratos). Morando aqui, os dois importam
 * o mesmo lugar sem um importar o outro.
 */
@Module({
  controllers: [ModeloContratoController],
  providers: [ModeloContratoService],
  exports: [ModeloContratoService],
})
export class ModeloContratoModule {}
