import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RotasApiController } from './rotas-api.controller';
import { RotasApiService } from './rotas-api.service';

/** Catálogo de rotas pro MCP com escopo `tudo` (26/10). */
@Module({
  imports: [DiscoveryModule],
  controllers: [RotasApiController],
  providers: [RotasApiService],
})
export class RotasApiModule {}
