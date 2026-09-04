import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { PedidosModule } from '@modules/pedidos/pedidos.module';
import { EmpresasModule } from '@modules/empresas/empresas.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { PropostaAceiteService } from './proposta-aceite.service';
import { ContratoErpPendenteJob } from './contrato-erp-pendente.job';
import { PropostaAnexosController } from './proposta-anexos.controller';
import { PropostaAnexosService } from './proposta-anexos.service';
import { PropostaErpService } from './proposta-erp.service';
import { PropostaExportService } from './proposta-export.service';
import { PropostasController } from './propostas.controller';
import { PropostasService } from './propostas.service';

@Module({
  imports: [
    ProdutosModule,
    PedidosModule,
    NotificacoesModule,
    EmailModule,
    TinyModule,
    EmpresasModule,
    // Marcos do funil (proposta enviada / assinada) movem a etapa do lead.
    LeadsModule,
  ],
  controllers: [PropostasController, PropostaAnexosController],
  providers: [
    PropostasService,
    PropostaExportService,
    PropostaAceiteService,
    PropostaErpService,
    PropostaAnexosService,
    // Rede pro envio automático: contrato assinado que não chegou no ERP.
    ContratoErpPendenteJob,
  ],
  // PropostaErpService sai porque quem sobe a proposta pro ERP agora é o
  // retorno da assinatura — o contrato assinado é que autoriza o envio.
  exports: [PropostasService, PropostaErpService],
})
export class PropostasModule {}
