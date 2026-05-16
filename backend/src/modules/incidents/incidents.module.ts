import { Global, Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

/**
 * Módulo de Incidentes — `@Global` porque adapters de marketplace (ML, Shopee,
 * Amazon, TikTok) precisam injetar `IncidentsService.registrarIncidente()`.
 */
@Global()
@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
