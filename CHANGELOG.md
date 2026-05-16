# Changelog

Todo trabalho relevante neste projeto é documentado aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versionamento segue [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-05-15

Primeira release pronta para produção. Resultado de 5 sprints de auditoria
+ remediação após audit inicial detectar 44 P0 + 80 P1 + 57 P2 issues.

### 🛡️ Security
- **Sprint 1** — 10 fixes P0 (deploy blockers):
  - Webhook secrets obrigatórios em produção (OMIE/Meta/Shopee/TikTok)
  - Express `trust proxy` + ML webhook IP whitelist correto
  - AuthGuard Redis cache (TTL 60s) — elimina 2 queries DB por request
  - `bulkAssignRep` com `@Roles` gate + scope GERENTE
  - `ComissoesService` filtro empresaId (ADMIN bypass, others restritos)
  - `FluxoExecutor` empresaId obrigatório em 6 ações
  - `EmpresaSequence` + `SequenceService` atomic (substitui `count()+1`)
  - Campaign idempotency `SETNX` + lock otimista no `disparar`
  - Cron singleton lock distribuído (8 jobs)
  - Comissão snapshot percentual preservado

- **Sprint 2** — 8 fixes multi-tenant + critical services (P1):
  - `AgendaItem.empresaId` (schema + service refactor)
  - `Tag.empresaId` (`@@unique([empresaId, nome])` substitui global)
  - `PricingService` empresaId obrigatório em todos métodos
  - `RelatoriosService` scope completo (SAC/Campanhas/Amostras agora filtram)
  - SSRF protection (`safe-request.ts` + 35 testes)
  - Schema audit: 38/38 modelos com tenant isolation
  - JWT hardening + `UsersService` ADMIN-only para cross-tenant
  - Rate limiting per-endpoint via Throttler + Redis storage

- **Sprint 3** — 8 fixes reliability + observability:
  - Webhook anti-replay (timestamp window 5min + signature dedup Redis 10min)
  - Refresh token rotation + reuse detection
  - BullMQ Dead Letter Queue + admin endpoint + Sentry capture
  - Pino sanitize PII + AsyncLocalStorage requestId
  - Sentry init com `beforeSend` strip PII
  - Health endpoints `/health` (liveness) + `/health/deep` (DB+Redis+BullMQ)
  - Pre-deploy backup script + restore script (com confirmação interativa)
  - Docker Compose + nginx (deploy VPS alternative — Railway é primary)

- **Sprint 3.5** — Redis TLS audit:
  - `buildRedisOptions()` helper aplica TLS em Railway production
  - Aplicado em 3 instâncias (RedisService, Throttler storage, BullMQ)

### ✨ Features
- **Sprint 4** — 8 fixes Railway readiness:
  - `railway.toml` (Web + Worker) com healthcheckPath
  - Worker entry point separado (`src/worker.ts` + `SERVICE_TYPE`)
  - WhatsApp session persistence via PostgreSQL (Baileys auth state cifrado AES-256-GCM)
  - Frontend scaffold: Vite + React 18 + Router 6 (createBrowserRouter)
  - Frontend hardening: api.ts singleton + JWT em memória + ErrorBoundary + usePermission RBAC
  - Playwright E2E: 10 testes smoke
  - `env.example.railway.txt` com 60+ vars categorizadas
  - Bundle inicial: **67.42 KB gzipped** (target era < 200KB)

- **Sprint 5** — 8 fixes CI/CD + monitoring:
  - GitHub Actions CI pipeline (build + test + e2e + Railway deploy)
  - Security workflow (npm audit + Prisma validate + gitleaks)
  - k6 load tests (smoke + stress + spike) com thresholds
  - Lighthouse CI budgets (performance > 85, a11y > 90, FCP < 2s, LCP < 3s)
  - UptimeRobot setup docs (`docs/monitoring.md`)
  - Backup automatizado diário pra S3-compatible com retention 30 dias
  - Restore runbook detalhado (12 passos + smoke tests pós-restore)
  - CHANGELOG + release workflow + `/version` endpoint

### 🏗️ Infrastructure
- Multi-tenant scope: 38/38 modelos Prisma com `empresaId`
- Tests: **332 unit** + **10 E2E** Playwright
- Sprint 1+2 schemas: `EmpresaSequence`, `Comissao.empresaId`, `Tag.empresaId`, `AgendaItem.empresaId`
- `Pedido.numero` e `Proposta.numero` agora unique por empresa (era global → cross-tenant collision)

### 📦 Dependencies
- NestJS 11 + Prisma 6.19.3 + Postgres 16 (Supabase) + BullMQ 5 + Redis 7
- Vite + React 18 + React Router 6
- Node.js 20 LTS

### 🔍 Auditoria
Audit inicial em `backend/_audit/AUDITORIA_2026-05-15.md` (181 findings).
Resultado pós-Sprint 5: **0 P0 + 0 P1 + ~10 P2 hardening** (não-bloqueantes).

### 🚦 Production status
- ✅ Railway deploy ready (3 services + 2 plugins)
- ✅ CI/CD pipeline (GitHub Actions)
- ✅ Monitoring (UptimeRobot + Sentry + Railway metrics)
- ✅ Backup diário S3
- ✅ DR runbook validado

---

## Próximas versões (planejadas)

### [1.1.0] — Próximo sprint (não iniciado)
- Frontend integração completa com APIs (módulos clientes, pedidos, campanhas)
- E2E expandido (visual regression via Playwright snapshots)
- Multi-region Railway deployment (latência menor pra SP/RJ)
- Mobile app (React Native + Expo) — fase 2

### [2.0.0] — Roadmap longo prazo
- Migração WhatsApp Baileys → WhatsApp Business API oficial (compliance Meta)
- Prisma upgrade 6.x → 7.x
- pgvector pra MullerBot (substitui keyword search quando volume > 500 produtos/empresa)
- Multi-language UI (i18n pt-BR + es-AR + en-US)
- White-label tenant branding
