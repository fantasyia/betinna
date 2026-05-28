import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/decorators/roles.decorator';
import { DbHealthService } from './db-health.service';

/**
 * DbHealthController — métricas de uso do Postgres.
 *
 * Apenas ADMIN (master da plataforma) — info cross-tenant, não faz sentido
 * pra DIRECTOR. Read-only, sem destrutivos.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/db-health')
export class DbHealthController {
  constructor(private readonly svc: DbHealthService) {}

  @Get()
  @ApiOperation({
    summary:
      'Tamanho do banco + top 30 tabelas. Usado pra detectar crescimento descontrolado antes do disco estourar.',
  })
  getStats() {
    return this.svc.getStats();
  }
}
