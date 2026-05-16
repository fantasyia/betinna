import { Module } from '@nestjs/common';
import { PedidosModule } from '@modules/pedidos/pedidos.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { PropostasController } from './propostas.controller';
import { PropostasService } from './propostas.service';

@Module({
  imports: [ProdutosModule, PedidosModule],
  controllers: [PropostasController],
  providers: [PropostasService],
  exports: [PropostasService],
})
export class PropostasModule {}
