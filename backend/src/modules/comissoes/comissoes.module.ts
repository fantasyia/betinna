import { Module } from '@nestjs/common';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { ComissoesController } from './comissoes.controller';
import { ComissoesFechamentoJob } from './comissoes-fechamento.job';
import { ComissoesService } from './comissoes.service';

@Module({
  imports: [NotificacoesModule, SendGridModule],
  controllers: [ComissoesController],
  providers: [ComissoesService, ComissoesFechamentoJob],
  exports: [ComissoesService],
})
export class ComissoesModule {}
