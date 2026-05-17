import { Controller, Get, Header, Logger } from '@nestjs/common';
import { Public } from '@shared/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * `GET /metrics` — endpoint Prometheus.
 *
 * `@Public()` (sem auth) — Prometheus scraper precisa acessar livre.
 * Em produção, proteja por IP whitelist (Railway/Cloudflare WAF) ou
 * Basic Auth via reverse proxy. NÃO retorna PII — só contadores agregados.
 */
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async snapshot(): Promise<string> {
    return this.metrics.snapshot();
  }
}
