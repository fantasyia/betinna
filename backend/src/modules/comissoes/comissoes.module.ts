import { Module } from '@nestjs/common';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { EmailModule } from '@integrations/email/email.module';
import { ComissoesController } from './comissoes.controller';
import { ComissoesFechamentoJob } from './comissoes-fechamento.job';
import { ComissoesService } from './comissoes.service';

@Module({
  imports: [NotificacoesModule, EmailModule],
  controllers: [ComissoesController],
  providers: [ComissoesService, ComissoesFechamentoJob],
  exports: [ComissoesService],
})
export class ComissoesModule {}
