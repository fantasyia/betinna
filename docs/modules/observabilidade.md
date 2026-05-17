# Observabilidade

Camadas de visibilidade pra rodar em produção sem surpresa.

## 1. Logs estruturados (Pino)

- Toda request HTTP loga `requestId` (UUID gerado pelo `RequestIdMiddleware`)
- Cross-service: o requestId é propagado downstream automaticamente via
  `X-Request-Id` header em todas as chamadas `HttpClientService.*` (Google,
  OMIE, ML, Shopee, Amazon, TikTok, Meta) — correlação end-to-end nos logs
  do parceiro também
- PII redacted: `authorization`, `cookie`, `password`, `senha`, `apiKey`, `token`,
  `access_token`, `refresh_token` viram `[REDACTED]`
- Em prod: ND-JSON pro Railway/CloudWatch. Em dev: pino-pretty.

## 2. Sentry

- **Backend** (`@sentry/node`) + **Frontend** (`@sentry/react`)
- `SENTRY_DSN` vazio → no-op (dev) com fallback ND-JSON no console
- `beforeSend` strip de PII (email, ip, username) — defesa em profundidade
  além de `sendDefaultPii: false`
- **Breadcrumbs** plugados em paths críticos:
  - `auth`: login-success / login-failed (com status code)
  - `omie`: push-start (pedido + itens) / push-success (numeroOmie)
  - `webhook`: meta-signature-ok / meta-invalid-signature
  - `comissoes`: fechamento-completo (totais)
- Quando uma exceção é capturada, Sentry mostra a sequência completa de
  eventos até o erro → debug 10× mais rápido em prod
- `tracesSampleRate`: 10% em prod, 100% em dev (custo vs visibility)

## 3. Métricas Prometheus

`GET /metrics` (Public — proteger via IP whitelist no Railway/Cloudflare).
Não retorna PII, só contadores agregados.

### Counters de domínio

| Métrica | Labels | O que mede |
|---|---|---|
| `betinna_pedidos_criados_total` | empresa, requer_aprovacao | Pedidos criados |
| `betinna_omie_push_total` | empresa, status (success/error) | Envios pro OMIE |
| `betinna_notificacoes_enviadas_total` | tipo, prioridade | Notificações in-app |
| `betinna_email_enviado_total` | template, status | E-mails transacionais |
| `betinna_mullerbot_requests_total` | cache_hit | Perguntas MullerBot |
| `betinna_webhook_recebido_total` | provedor, status | Webhooks recebidos |

### Histograms

| Métrica | Buckets | O que mede |
|---|---|---|
| `betinna_http_request_duration_seconds` | 5ms–10s | Latência HTTP por rota |
| `betinna_omie_push_duration_seconds` | 100ms–30s | Tempo de envio pro OMIE |

### Default metrics (auto-coletados)

- `betinna_nodejs_eventloop_lag_seconds` — event loop saúde
- `betinna_nodejs_gc_duration_seconds` — pausas GC
- `betinna_process_resident_memory_bytes` — memória
- `betinna_process_cpu_seconds_total` — CPU

### Dashboards sugeridos (Grafana)

1. **Performance**: P50/P95/P99 de `http_request_duration` por rota
2. **Domínio**: rate de pedidos/min, % cache hit MullerBot, % erro push OMIE
3. **Infra**: event loop lag (alerta > 100ms), memória heap, GC duration

## 4. Health check expandido

`GET /health/deep` (ADMIN only):

```json
{
  "status": "ok",
  "uptime": 12345,
  "checks": {
    "database": { "status": "ok", "latencyMs": 8 },
    "redis": { "status": "ok", "latencyMs": 3 },
    "bullmq": { "status": "ok", "queues": { "fluxo-execucao": 0 } },
    "supabase": { "status": "ok", "latencyMs": 120 },
    "integracoes": {
      "status": "ok",
      "conectadas": { "omie": 5, "whatsapp": 3, "google_calendar": 12 }
    }
  }
}
```

- `database/redis/bullmq` críticos — degradação aqui retorna 503
- `supabase` aceita `degraded` (HTTP > 200 OK mas dependência externa lenta)
- `integracoes` é só fotografia do DB — não chama APIs reais (custo + rate limit)

`GET /health` (público, sem auth) — liveness leve sem checks de dependência.
Usado pelo Docker `HEALTHCHECK` + Kubernetes liveness probe.

## 5. Backup automatizado

### Workflow GitHub Actions (`backup.yml`)

Roda diariamente 03:00 UTC + `workflow_dispatch` manual.

- `pg_dump -Fc -Z9` (custom format, max compression)
- Upload pra S3-compatible (Cloudflare R2 / AWS S3)
- Retention: keep últimos 30 daily, apaga mais velhos
- Falha → cria issue automático no repo

### Script standalone (`npm run db:backup`)

`backend/scripts/backup-to-storage.ts` — alternativa pra rodar local ou
em outro CI:

- `pg_dump` → arquivo `.dump` em tmpdir
- Upload pra Supabase Storage bucket `db-backups` (privado)
- Path: `<YYYY-MM>/betinna-<timestamp>.dump`
- Retention 30 dias via `Storage API`
- Exit 0 sucesso, 1 falha (qualquer etapa)

Útil pra:
- Pre-deploy backup manual
- DBA on-call em emergência
- Migrar entre ambientes (rodar local, restaurar em outro)

## 6. Rate limiting

### Global (`TenantThrottlerGuard`)

Estende `ThrottlerGuard` padrão usando `empresaId` como chave (cai pro IP em rotas públicas).
Resolve cenários de NAT compartilhado.

3 buckets nomeados (configurável em `app.module.ts`):
- `short`: 10 req/s — burst protection
- `medium`: 100 req/min — API geral
- `long`: 300 req/min — sustained throughput por tenant

Storage: Redis (cross-réplica). Em test → in-memory.

### Per-endpoint

| Endpoint | Limit |
|---|---|
| `/mullerbot/perguntar` | 30 req/min (custo OpenAI) |
| `/import/clientes`, `/import/produtos` | 5 req/min (operação pesada) |
| `/auth/login`, `/auth/refresh` | 10 req/15min (anti-brute) |
| Webhooks (Meta, ML, Shopee, etc) | 200 req/min (bursts de campanhas) |

Aplicação via `@Throttle({ default: { limit, ttl } })` no controller.
