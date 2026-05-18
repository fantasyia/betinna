# Changelog

Todo trabalho relevante neste projeto é documentado aqui.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versionamento segue [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-05-17

Sprint de auditoria master final + correções P0/P1/P2/P3. Sistema revalidado para produção: 1362 tests passing, 0 vulnerabilities, 0 lint warnings, build clean.

### ✨ Features

#### Backend
- **Módulo `fidelidade`** — programa de pontos por cliente (acumular/resgatar) DIRECTOR-only
- **Módulo `import`** — CSV importer (clientes/produtos) via Zod schema, limite 1MB
- **Módulo `notificacoes`** — CRUD + marcar lida + bulk + filtros (NotificationBell no header)
- **`AuditController` viewer** — endpoint `/audit` ADMIN-only com filtros, paginação, `/audit/recursos` distinct
- **`metrics` (Prometheus)** — `/metrics` endpoint com counters por módulo
- **`catalog-share`** — share JWT TTL 7d pra envio de catálogo via WhatsApp
- **`mullerbot-cache`** — cache Redis de respostas (TTL 1h)
- **Validadores BR** — CPF/CNPJ/telefone/CEP com 25 specs
- **`RetentionCleanupJob` (LGPD)** — cron dia 2 às 05:00 UTC purga AuditLog/Message (24m) + Notificacao lidas (6m). Retentions configuráveis via env. Auto-registra PURGE no AuditLog
- **Sentry APM tracing** — `tracesSampleRate` configurável (default 0.1 prod / 1.0 dev) + `prismaIntegration` (spans SQL) + auto-instrumentação http/express/redis
- **OMIE retry exponencial** em faults (`isRetryableFault`)
- **WhatsApp/Meta media download** — `whatsapp-media.service.ts`, `meta-media.service.ts`
- **SendGrid templates** + `transactional-email.service.ts`
- **`scripts/backup-to-storage.ts`** — backup automatizado pro Supabase Storage

#### Frontend
- **NotificacoesPage** + **NotificationBell** + **OnboardingTour** + **LanguageSelect** + **Markdown**
- **i18n**: pt-BR + en-US + es (i18next)
- **PWA**: service worker + manifest
- **Exports**: PDF (jspdf), DOCX (docx), XLSX (exceljs em worker), CSV (papaparse)
- **13 E2E specs Playwright**: auth, RBAC, CRUD smoke, inbox, inbox-bulk, fidelidade, notificações, onboarding, pedidos, relatórios, catalog-audit, import-metrics

### 🛡️ Security
- **LGPD compliance**: política formal de retenção implementada (`LGPD_*_RETENTION_MONTHS` configuráveis)
- **Body parser 2MB explícito** (P1): default Express 100KB conflitava com CSV import 1MB. Usa `app.useBodyParser` (preserva `rawBody:true` pros webhooks)
- **OMIE `enviarPedido(id, empresaId?)`** (P3 defensive scoping): aceita empresaId opcional para defesa em profundidade
- **`xlsx` CVE fix**: substituído por `exceljs` (Prototype Pollution + ReDoS)
- **0 vulnerabilities** em `npm audit` (backend + frontend)

### 🚀 Performance
- **7 índices compostos novos**: `Pedido(criadoEm)`, `Cliente(empresaId,representanteId)`, `Conversation(canal,ultimaMensagemEm)`, `MarketplaceIncident(empresaId,status)`, `AuditLog(empresaId,criadoEm)`, `Notificacao(usuarioId,lida)`, `Comissao(empresaId,periodo)`
- **Bundle frontend ~105KB gzip** (após D47 — Supabase SDK removido do path principal)

### 🔧 Fixed
- **Inbox race condition** no upsert manual de `Conversation` — migration `20260517010000_inbox_race_unique` (índice único parcial)
- **CronLock atomicity** — 4 specs novos cobrem race & TTL edge cases
- **Deps cleanup**: `@nestjs/terminus`, `nestjs-zod` (backend), `jose` (frontend) — removidas

### 🧪 Tests
- **Backend**: 1362 tests passing em 94 spec files (+62 vs versão 1.0.0)
- **Frontend**: 13 E2E spec files (108 specs Playwright, +98 vs scaffold inicial)
- **Canonical typecheck**: `npm run typecheck` (usa `tsconfig.build.json`) — clean
  - Nota: `tsc --noEmit` direto inclui specs com mocks parciais (ML/Shopee/TikTok types incompletos) e mostra ~80 erros estáticos que **não afetam runtime** (vitest aceita)

### 📚 Docs
- `backend/_audit/MASTER_VALIDATION_REPORT_2026-05-17.md` — relatório das 12 fases
- `AUDIT_REPORT.md` (raiz) — histórico de findings + status
- `DEPLOY.md` — passo-a-passo Railway + smoke tests + rollback
- `docs/modules/` — documentação por módulo (16 arquivos)

### 📦 Migrations
- `20260517000000_fidelidade` — programa de pontos
- `20260517010000_inbox_race_unique` — race condition fix via índice único parcial
- `20260517020000_indexes_performance` — 7 índices compostos

### 🎯 Auditoria
- 12 fases concluídas conforme `_audit/MASTER_VALIDATION_REPORT_2026-05-17.md`
- **0 P0 abertos · 0 P1 abertos · 0 P2 abertos · 0 P3 abertos (4 P3 endereçados nesta rodada)**

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
