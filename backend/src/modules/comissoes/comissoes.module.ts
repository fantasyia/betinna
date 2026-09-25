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
// Mora em pedidos/ (é de pedido), mas é registrado AQUI: o lançamento do mês
// (Comissões) o usa, e Pedidos já importa Comissões — o inverso seria ciclo.
import { PedidoComissaoErpService } from '@modules/pedidos/pedido-comissao-erp.service';

@Module({
  imports: [NotificacoesModule, EmailModule, TinyModule],
  controllers: [ComissoesController],
  providers: [
    ComissoesService,
    ComissoesFechamentoJob,
    ComissaoErpService,
    ComissaoRepVisaoService,
    ContratoComissoesService,
    ContratoComissaoErpService,
    ComissaoBaixaSyncService,
    PedidoComissaoErpService,
  ],
  exports: [
    ComissoesService,
    ComissaoErpService,
    ContratoComissoesService,
    ContratoComissaoErpService,
    ComissaoBaixaSyncService,
    PedidoComissaoErpService,
  ],
})
export class ComissoesModule {}
