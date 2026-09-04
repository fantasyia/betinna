import { Module } from '@nestjs/common';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';

/** Leitura dos contratos de locação — quem os cria é o aceite da proposta. */
@Module({
  controllers: [ContratosController],
  providers: [ContratosService],
  exports: [ContratosService],
})
export class ContratosModule {}
