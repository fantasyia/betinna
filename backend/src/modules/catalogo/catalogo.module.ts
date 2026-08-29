import { Module } from '@nestjs/common';
import { EmpresasModule } from '@modules/empresas/empresas.module';
import { ClientesModule } from '@modules/clientes/clientes.module';
import { ProdutosModule } from '@modules/produtos/produtos.module';
import { CatalogShareService } from './catalog-share.service';
import { CatalogoPdfService } from './catalogo-pdf.service';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';

@Module({
  imports: [ClientesModule, ProdutosModule, EmpresasModule],
  controllers: [CatalogoController],
  providers: [CatalogoService, CatalogShareService, CatalogoPdfService],
  exports: [CatalogoService, CatalogShareService, CatalogoPdfService],
})
export class CatalogoModule {}
