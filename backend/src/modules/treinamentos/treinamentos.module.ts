import { Module } from '@nestjs/common';
import { TreinamentosController } from './treinamentos.controller';
import { TreinamentosService } from './treinamentos.service';
import { TreinamentoArquivoService } from './treinamento-arquivo.service';

/** Vídeos de treinamento interno — o arquivo mora no YouTube, aqui fica o ponteiro. */
@Module({
  controllers: [TreinamentosController],
  providers: [TreinamentosService, TreinamentoArquivoService],
  exports: [TreinamentosService, TreinamentoArquivoService],
})
export class TreinamentosModule {}
