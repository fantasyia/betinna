import { Module } from '@nestjs/common';
import { EmpresaLogoService } from './empresa-logo.service';
import { EmpresasController } from './empresas.controller';
import { EmpresasService } from './empresas.service';

@Module({
  controllers: [EmpresasController],
  providers: [EmpresasService, EmpresaLogoService],
  exports: [EmpresasService, EmpresaLogoService],
})
export class EmpresasModule {}
