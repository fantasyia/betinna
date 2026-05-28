import { Module } from '@nestjs/common';
import { DbHealthController } from './db-health.controller';
import { DbHealthService } from './db-health.service';
import { SeedDemoController } from './seed-demo.controller';
import { SeedDemoService } from './seed-demo.service';

/**
 * AdminModule — utilitários administrativos cross-tenant.
 *
 * Conteúdo:
 *  - SeedDemoService: geração/limpeza de dataset demo
 *  - DbHealthService: visibilidade sobre tamanho do Postgres (criado 2026-05-27
 *    depois do incidente de disco cheio que travou o banco)
 *
 * Todas as rotas deste módulo são gated em @Roles (ver controllers).
 */
@Module({
  // PrismaService vem do @Global() PrismaModule registrado no AppModule.
  controllers: [SeedDemoController, DbHealthController],
  providers: [SeedDemoService, DbHealthService],
  exports: [SeedDemoService, DbHealthService],
})
export class AdminModule {}
