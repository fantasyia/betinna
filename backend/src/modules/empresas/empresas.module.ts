import { Module } from '@nestjs/common';
import { RagModule } from '@modules/rag/rag.module';
import { EvolutionModule } from '@integrations/evolution/evolution.module';
import { EmpresaLogoService } from './empresa-logo.service';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';

@Module({
  imports: [RagModule, EvolutionModule],
  controllers: [EmpresasController],
  providers: [EmpresasService, EmpresaLogoService],
  exports: [EmpresasService, EmpresaLogoService],
})
export class EmpresasModule {}
