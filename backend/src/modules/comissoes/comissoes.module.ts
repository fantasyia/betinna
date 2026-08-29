import { Module } from '@nestjs/common';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { EmailModule } from '@integrations/email/email.module';
import { ComissoesController } from './comissoes.controller';
import { ComissoesFechamentoJob } from './comissoes-fechamento.job';
import { ComissoesService } from './comissoes.service';
import { ComissaoErpService } from './comissao-erp.service';
import { ComissaoRepVisaoService } from './comissao-rep-visao.service';
import { TinyModule } from '@integrations/tiny/tiny.module';

@Module({
  imports: [NotificacoesModule, EmailModule, TinyModule],
  controllers: [ComissoesController],
  providers: [
    ComissoesService,
    ComissoesFechamentoJob,
    ComissaoErpService,
    ComissaoRepVisaoService,
  ],
  exports: [ComissoesService, ComissaoErpService],
})
export class ComissoesModule {}
