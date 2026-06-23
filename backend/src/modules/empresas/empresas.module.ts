import { Module } from '@nestjs/common';
import { RagModule } from '@modules/rag/rag.module';
import { EmpresaLogoService } from './empresa-logo.service';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';

@Module({
  imports: [RagModule],
  controllers: [EmpresasController],
  providers: [EmpresasService, EmpresaLogoService],
  exports: [EmpresasService, EmpresaLogoService],
})
export class EmpresasModule {}
