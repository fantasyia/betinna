import { Module } from '@nestjs/common';
import { TagsModule } from '@modules/tags/tags.module';
import { BrasilApiService } from '@integrations/brasilapi/brasilapi.service';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';
import { ListasDinamicasService } from './listas-dinamicas.service';
import { NotasPrivadasController } from './notas-privadas.controller';
import { NotasPrivadasService } from './notas-privadas.service';

@Module({
  imports: [TagsModule],
  controllers: [ClientesController, NotasPrivadasController, DocumentosController],
  providers: [
    ClientesService,
    ListasDinamicasService,
    NotasPrivadasService,
    DocumentosService,
    BrasilApiService,
  ],
  exports: [ClientesService, ListasDinamicasService],
})
export class ClientesModule {}
