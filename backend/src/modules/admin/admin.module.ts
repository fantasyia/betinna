import { Module } from '@nestjs/common';
import { DbHealthController } from './db-health.controller';
import { DbHealthService } from './db-health.service';
import { LimparEmpresaController } from './limpar-empresa.controller';
import { LimparEmpresaService } from './limpar-empresa.service';

/**
 * AdminModule — utilitários administrativos cross-tenant.
 *
 * Conteúdo:
 *  - DbHealthService: visibilidade sobre tamanho do Postgres (criado 2026-05-27
 *    depois do incidente de disco cheio que travou o banco)
 *
 * Todas as rotas deste módulo são gated em @Roles (ver controllers).
 */
@Module({
  // PrismaService vem do @Global() PrismaModule registrado no AppModule.
  controllers: [DbHealthController, LimparEmpresaController],
  providers: [DbHealthService, LimparEmpresaService],
  exports: [DbHealthService],
})
export class AdminModule {}
