import { Module } from '@nestjs/common';
import { SeedDemoController } from './seed-demo.controller';
import { SeedDemoService } from './seed-demo.service';

/**
 * AdminModule — utilitários administrativos cross-tenant.
 *
 * Por enquanto contém apenas o SeedDemoService (geração de dataset demo).
 * Pode crescer pra hospedar outras ferramentas de operação (impersonate,
 * audit dumps, system metrics, etc.) no futuro.
 *
 * Todas as rotas deste módulo são gated em @Roles('ADMIN', 'DIRECTOR')
 * — ver SeedDemoController.
 */
@Module({
  // PrismaService vem do @Global() PrismaModule registrado no AppModule.
  controllers: [SeedDemoController],
  providers: [SeedDemoService],
  exports: [SeedDemoService],
})
export class AdminModule {}
