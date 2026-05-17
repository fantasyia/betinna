import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * MetricsService — exposição Prometheus.
 *
 * Coleta:
 *  - **Default metrics** do Node (event loop lag, GC, heap, CPU) via prom-client
 *  - **HTTP** (count + duration) via interceptor opcional
 *  - **Custom counters** específicos do domínio:
 *      - pedidos_criados_total
 *      - omie_push_total{status}
 *      - notificacoes_enviadas_total{tipo,canal}
 *      - email_enviado_total{template,status}
 *      - mullerbot_request_total{cache_hit}
 *      - webhook_recebido_total{provedor,status}
 *
 * Endpoint `GET /metrics` (Public, sem auth) expõe pra scraping. Em produção,
 * proteger via IP whitelist no Railway/Cloudflare ou autenticação Basic.
 *
 * Naming convention: snake_case, sufixo `_total` pra counters, `_seconds`
 * pra histograms de tempo (padrão Prometheus).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  // ─── Counters de domínio ────────────────────────────────────────────

  readonly pedidosCriados = new Counter({
    name: 'betinna_pedidos_criados_total',
    help: 'Pedidos criados (com ou sem aprovação).',
    labelNames: ['empresa', 'requer_aprovacao'] as const,
  });

  readonly omiePush = new Counter({
    name: 'betinna_omie_push_total',
    help: 'Envios pro OMIE (status: success | error).',
    labelNames: ['empresa', 'status'] as const,
  });

  readonly notificacoesEnviadas = new Counter({
    name: 'betinna_notificacoes_enviadas_total',
    help: 'Notificações in-app criadas.',
    labelNames: ['tipo', 'prioridade'] as const,
  });

  readonly emailEnviado = new Counter({
    name: 'betinna_email_enviado_total',
    help: 'E-mails transacionais enviados.',
    labelNames: ['template', 'status'] as const,
  });

  readonly mullerbotRequests = new Counter({
    name: 'betinna_mullerbot_requests_total',
    help: 'Perguntas processadas pelo MullerBot.',
    labelNames: ['cache_hit'] as const,
  });

  readonly webhookRecebido = new Counter({
    name: 'betinna_webhook_recebido_total',
    help: 'Webhooks recebidos de integrações externas.',
    labelNames: ['provedor', 'status'] as const,
  });

  // ─── Gauges ─────────────────────────────────────────────────────────

  readonly bullmqJobsAtivos = new Gauge({
    name: 'betinna_bullmq_jobs_ativos',
    help: 'Jobs BullMQ em processamento.',
    labelNames: ['queue'] as const,
  });

  // ─── Histograms ─────────────────────────────────────────────────────

  readonly httpDuration = new Histogram({
    name: 'betinna_http_request_duration_seconds',
    help: 'Tempo de processamento HTTP por rota.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

  readonly omiePushDuration = new Histogram({
    name: 'betinna_omie_push_duration_seconds',
    help: 'Tempo de envio de pedido pro OMIE.',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  });

  onModuleInit(): void {
    // Default metrics: event loop lag, GC, CPU, heap usage
    collectDefaultMetrics({ register: this.registry, prefix: 'betinna_' });

    // Registra custom no mesmo registry
    // Registra individualmente — TS reclama de variância no array por causa
    // dos labelNames diferentes em cada Counter/Histogram.
    this.registry.registerMetric(this.pedidosCriados);
    this.registry.registerMetric(this.omiePush);
    this.registry.registerMetric(this.notificacoesEnviadas);
    this.registry.registerMetric(this.emailEnviado);
    this.registry.registerMetric(this.mullerbotRequests);
    this.registry.registerMetric(this.webhookRecebido);
    this.registry.registerMetric(this.bullmqJobsAtivos);
    this.registry.registerMetric(this.httpDuration);
    this.registry.registerMetric(this.omiePushDuration);

    this.logger.log('Prometheus metrics inicializadas (/metrics)');
  }

  async snapshot(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
