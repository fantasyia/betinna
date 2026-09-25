import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { PedidosModule } from '@modules/pedidos/pedidos.module';
import { EmpresasModule } from '@modules/empresas/empresas.module';
import { LeadsModule } from '@modules/leads/leads.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { KanbanModule } from '@modules/kanban/kanban.module';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { ModeloContratoModule } from '@modules/modelo-contrato/modelo-contrato.module';
import { PropostaAceiteService } from './proposta-aceite.service';
import { ContratoErpPendenteJob } from './contrato-erp-pendente.job';
import { PropostaAceiteVencimentoJob } from './proposta-aceite-vencimento.job';
import { PropostaAnexosController } from './proposta-anexos.controller';
import { PropostaAnexosService } from './proposta-anexos.service';
import { ContratoPreviaService } from './contrato-previa.service';
import { PropostaErpService } from './proposta-erp.service';
import { PropostaExportService } from './proposta-export.service';
import { PropostasController } from './propostas.controller';
import { SelecaoModeloService } from './selecao-modelo.service';
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
    // Tarefa pro rep quando o link de aceite vence.
    KanbanModule,
    // O contrato do aceite sai com o modelo EM USO (subido pela tela).
    ModeloContratoModule,
  ],
  controllers: [PropostasController, PropostaAnexosController],
  providers: [
    SelecaoModeloService,
    PropostasService,
    PropostaExportService,
    PropostaAceiteService,
    PropostaErpService,
    PropostaAnexosService,
    ContratoPreviaService,
    // Rede pro envio automático: contrato assinado que não chegou no ERP.
    ContratoErpPendenteJob,
    // Rede pro outro lado do silêncio: link de aceite que morre sem ninguém ver.
    PropostaAceiteVencimentoJob,
  ],
  // PropostaErpService sai porque quem sobe a proposta pro ERP agora é o
  // retorno da assinatura — o contrato assinado é que autoriza o envio.
  exports: [SelecaoModeloService, PropostasService, PropostaErpService],
})
export class PropostasModule {}
