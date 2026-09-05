import { Module } from '@nestjs/common';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { EmailModule } from '@integrations/email/email.module';
import { ComissoesController } from './comissoes.controller';
import { ComissoesFechamentoJob } from './comissoes-fechamento.job';
import { ComissoesService } from './comissoes.service';
import { ComissaoErpService } from './comissao-erp.service';
import { ComissaoRepVisaoService } from './comissao-rep-visao.service';
import { ContratoComissoesService } from './contrato-comissoes.service';
import { ContratoComissaoErpService } from './contrato-comissao-erp.service';
import { ComissaoBaixaSyncService } from './comissao-baixa-sync.service';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { forwardRef } from '@nestjs/common';
import { ContratosModule } from '@modules/contratos/contratos.module';

@Module({
  // forwardRef porque ContratosModule também importa este (o serviço de
  // mensalidade usa a comissão de locação, e o controller de comissões expõe a
  // varredura). É ciclo de módulo, não de dependência real.
  imports: [NotificacoesModule, EmailModule, TinyModule, forwardRef(() => ContratosModule)],
  controllers: [ComissoesController],
  providers: [
    ComissoesService,
    ComissoesFechamentoJob,
    ComissaoErpService,
    ComissaoRepVisaoService,
    ContratoComissoesService,
    ContratoComissaoErpService,
    ComissaoBaixaSyncService,
  ],
  exports: [
    ComissoesService,
    ComissaoErpService,
    ContratoComissoesService,
    ContratoComissaoErpService,
    ComissaoBaixaSyncService,
  ],
})
export class ComissoesModule {}
