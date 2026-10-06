import { Module } from '@nestjs/common';
import { VitrineAdminController } from './vitrine-admin.controller';
import { VitrineAdminService } from './vitrine-admin.service';
import { VitrineFotosService } from './vitrine-fotos.service';
import { VitrineMidiaController } from './vitrine-midia.controller';
import { VitrinePublicaController } from './vitrine-publica.controller';
import { VitrinePublicaService } from './vitrine-publica.service';

/**
 * Vitrine de atacado (Fase 1 — Ribelt Distribuidora Têxtil, 05/10/2026).
 * Ligada POR EMPRESA (tabela `Vitrine`); sem ela, nada daqui age.
 */
@Module({
  controllers: [VitrineAdminController, VitrineMidiaController, VitrinePublicaController],
  providers: [VitrineAdminService, VitrineFotosService, VitrinePublicaService],
  exports: [VitrineAdminService, VitrineFotosService],
})
export class VitrineModule {}
