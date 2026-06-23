import { Module } from '@nestjs/common';
import { ClientesModule } from '@modules/clientes/clientes.module';
import { RagModule } from '@modules/rag/rag.module';
import { PrecosEspeciaisController } from './precos-especiais.controller';
import { PrecosEspeciaisService } from './precos-especiais.service';
import { PricingService } from './pricing.service';
import { ProdutosController } from './produtos.controller';
import { ProdutosService } from './produtos.service';

@Module({
  imports: [ClientesModule, RagModule],
  controllers: [ProdutosController, PrecosEspeciaisController],
  providers: [ProdutosService, PricingService, PrecosEspeciaisService],
  exports: [ProdutosService, PricingService, PrecosEspeciaisService],
})
export class ProdutosModule {}
