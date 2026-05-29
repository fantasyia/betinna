import { Module } from '@nestjs/common';
import { PedidosModule } from '@modules/pedidos/pedidos.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { NotificacoesModule } from '@modules/notificacoes/notificacoes.module';
import { PropostaAceiteService } from './proposta-aceite.service';
import { PropostaExportService } from './proposta-export.service';
import { PropostasController } from './propostas.controller';
import { PropostasService } from './propostas.service';

@Module({
  imports: [ProdutosModule, PedidosModule, NotificacoesModule],
  controllers: [PropostasController],
  providers: [PropostasService, PropostaExportService, PropostaAceiteService],
  exports: [PropostasService],
})
export class PropostasModule {}
