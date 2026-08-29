import { Module } from '@nestjs/common';
import { EmailModule } from '@integrations/email/email.module';
import { PedidosModule } from '@modules/pedidos/pedidos.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { TinyModule } from '@integrations/tiny/tiny.module';
import { PropostaAceiteService } from './proposta-aceite.service';
import { PropostaErpService } from './proposta-erp.service';
import { PropostaExportService } from './proposta-export.service';
import { PropostasController } from './propostas.controller';
import { PropostasService } from './propostas.service';

@Module({
  imports: [ProdutosModule, PedidosModule, NotificacoesModule, EmailModule, TinyModule],
  controllers: [PropostasController],
  providers: [PropostasService, PropostaExportService, PropostaAceiteService, PropostaErpService],
  exports: [PropostasService],
})
export class PropostasModule {}
