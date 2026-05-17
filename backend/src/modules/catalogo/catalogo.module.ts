import { Module } from '@nestjs/common';
import { ClientesModule } from '@modules/clientes/clientes.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { CatalogShareService } from './catalog-share.service';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';

@Module({
  imports: [ClientesModule, ProdutosModule],
  controllers: [CatalogoController],
  providers: [CatalogoService, CatalogShareService],
  exports: [CatalogoService, CatalogShareService],
})
export class CatalogoModule {}
