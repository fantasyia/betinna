import { Module } from '@nestjs/common';
import { RagModule } from '@modules/rag/rag.module';
import { EvolutionModule } from '@integrations/evolution/evolution.module';
import { MarcaTenantService } from './marca-tenant.service';
import { EmpresaLogoService } from './empresa-logo.service';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';

@Module({
  imports: [RagModule, EvolutionModule],
  controllers: [EmpresasController],
  providers: [EmpresasService, EmpresaLogoService, MarcaTenantService],
  exports: [EmpresasService, EmpresaLogoService, MarcaTenantService],
})
export class EmpresasModule {}
