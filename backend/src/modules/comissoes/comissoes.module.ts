import { Module } from '@nestjs/common';
import { ComissoesController } from './comissoes.controller';
import { ComissoesFechamentoJob } from './comissoes-fechamento.job';
import { ComissoesService } from './comissoes.service';

@Module({
  controllers: [ComissoesController],
  providers: [ComissoesService, ComissoesFechamentoJob],
  exports: [ComissoesService],
})
export class ComissoesModule {}
