import { Controller, Get, Header, Logger } from '@nestjs/common';
import { Roles } from '@shared/decorators/roles.decorator';
import { MetricsService } from './metrics.service';

/**
 * `GET /metrics` — snapshot agregado (Prometheus-style).
 *
 * **ADMIN-only** (não é mais `@Public()`). O snapshot tem labels POR EMPRESA,
 * então deixar aberto vazava dados por tenant pra qualquer um na internet — e
 * pra usuários comuns de outra empresa. ADMIN é o operador da plataforma
 * (cross-tenant, D48), o único que pode ver métricas de todos os tenants.
 *
 * Se um scraper externo (Prometheus) precisar raspar isto no futuro, o caminho
 * é um token interno dedicado (header), não reabrir pra internet.
 */
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metrics: MetricsService) {}

  @Roles('ADMIN')
  @Get()
  @Header('Cache-Control', 'no-store')
  async snapshot(): Promise<string> {
    return this.metrics.snapshot();
  }
}
