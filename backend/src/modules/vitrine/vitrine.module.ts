import { Module } from '@nestjs/common';
import { VitrineAdminController } from './vitrine-admin.controller';
import { VitrineAdminService } from './vitrine-admin.service';

/**
 * Vitrine de atacado (Fase 1 — Ribelt Distribuidora Têxtil, 05/10/2026).
 * Ligada POR EMPRESA (tabela `Vitrine`); sem ela, nada daqui age.
 */
@Module({
  controllers: [VitrineAdminController],
  providers: [VitrineAdminService],
  exports: [VitrineAdminService],
})
export class VitrineModule {}
