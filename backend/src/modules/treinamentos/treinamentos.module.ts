import { Module } from '@nestjs/common';
import { TreinamentosController } from './treinamentos.controller';
import { TreinamentosService } from './treinamentos.service';

/** Vídeos de treinamento interno — o arquivo mora no YouTube, aqui fica o ponteiro. */
@Module({
  controllers: [TreinamentosController],
  providers: [TreinamentosService],
  exports: [TreinamentosService],
})
export class TreinamentosModule {}
