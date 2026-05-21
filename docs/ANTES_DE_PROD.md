# Antes de prod — Checklist pré-lançamento Betinna.ai

> Lista do que precisa estar pronto antes de abrir o produto pros primeiros
> clientes reais (Beta fechado → GA). Atualizado em 2026-05-19 (v1.5.0).

---

## 🚦 Status macro

| Categoria | Status | Notas |
|---|---|---|
| **Backend (API + Worker)** | ✅ Pronto | 1372+ testes passando, 75+ endpoints, multi-tenant + RBAC |
| **Frontend (43 páginas)** | ✅ Pronto | TS strict limpo, lazy load, brandbook aplicado, OnboardingTour |
| **Deploy Railway** | ✅ Ativo | api + worker + frontend, auto-deploy `main` |
| **Migrations versionadas** | ✅ Pronto | 16 migrations + smart deploy script |
| **Auth + RBAC** | ✅ Pronto | D47 cookie httpOnly, ADMIN/DIRECTOR/GERENTE/SAC/REP |
| **Identidade visual** | ✅ Pronto | Brandbook v1.5.0 aplicado (navy/cyan/magenta, radius 10px) |
| **PWA** | ✅ Pronto | Manifest brandbook, SW, banner install + update |
| **A11y** | ✅ WCAG AA básico | Skip-to-content, ARIA, focus visible |
| **SEO** | ✅ Pronto | OG, robots.txt, meta description |
| **Sentry** | ✅ Validado | Backend + frontend + breadcrumbs |
| **E2E coverage** | ✅ 52+ passando | 19 spec files, 143 testes |
| **Bundle size** | ✅ Otimizado | Chunks pesados separados, lazy load |
| **Backups** | ⚠️ Manual | Supabase backups automáticos diários — testar restore antes |
| **LGPD** | ⚠️ Política a redigir | Termos de uso + privacidade — task externa |
| **Domínio próprio** | ⚠️ Pendente | Railway provisiona `*.up.railway.app`; comprar `betinna.ai` |
| **Monitoring** | ⚠️ A configurar | Alertas Sentry > N erros / dia (Slack/email do Léo) |

---

## ✅ Pronto

### Infraestrutura

- **Railway**: 3 serviços (api, worker, frontend) com healthcheck `/api/v1/health`
- **Supabase**: Postgres + Storage + Auth (managed)
- **Redis**: BullMQ pra jobs + Throttler
- **CI**: GitHub Actions roda lint + typecheck + tests + e2e + deploy gated
- **SSL**: Railway provisiona certificados automáticos (TLS 1.3)

### Segurança

- Helmet ativo (CSP, HSTS, X-Frame-Options, etc)
- Throttler 10req/15min em `/auth` (anti-brute)
- HMAC validado em todos os webhooks externos (OMIE, ML, Shopee, TikTok, Meta)
- Refresh token em cookie httpOnly (D47) — XSS-resistente
- Integrations cipher AES-256-GCM (D9)
- Multi-tenant: todo query filtra `empresaId` (auditado em P0)
- Audit log automático via `@Audit` decorator

### Produto

- 43 páginas frontend, 17 cobertas com E2E dedicado + 10 smoke tests
- OnboardingTour por role (5-7 steps cada)
- MullerBot RAG sobre produtos do tenant
- Inbox unificada (WhatsApp + Meta + ML + Shopee + Amazon + TikTok)
- Fluxos de automação BullMQ + 7 tipos de ação
- Comissões com snapshot histórico + cron mensal
- Marketplaces SAC completo (4 etapas finalizadas)
- Seed Demo (8 modelos, 3 endpoints admin)
- Upload de logo da empresa (v1.5.0)
- Agenda com recorrência (v1.5.0)
- Formulários multi-step (v1.5.0)
- FluxoEditor com undo/redo (v1.5.0)

---

## ⚠️ Pendente / Recomendado antes de marketing

### 1. Domínio próprio + DNS

```
Comprar betinna.ai → Cloudflare DNS:
  betinna.ai            CNAME → frontend-production-fd70.up.railway.app
  api.betinna.ai        CNAME → api-production-9426.up.railway.app
  app.betinna.ai        CNAME → frontend-production-fd70.up.railway.app
```

Railway aceita domínios custom no dashboard de cada serviço. Atualizar
env `E2E_BASE_URL` e `VITE_API_URL` no GitHub Secrets.

### 2. LGPD / Termos de uso

- Termos de uso (link no rodapé)
- Política de privacidade (link no rodapé)
- Banner de cookies (opcional — sem analytics 3rd-party hoje)
- DPO designado (interno)
- Procedimento de exclusão de dados (LGPD art. 18)

### 3. Backup + restore testado

- Supabase faz backup diário automático (PIT recovery 7 dias)
- **Testar restore** em projeto Supabase staging antes do GA
- Script `backend/scripts/backup-to-storage.ts` faz dump manual → Supabase Storage

### 4. Monitoring

- **Sentry**: configurar alertas
  - Erros 5xx > 10 / hora → email + Slack
  - Performance: P95 latência > 2s → warning
- **Railway logs**: configurar drain (Datadog/Logtail) — long-term retention
- **Uptime**: UptimeRobot ou Better Stack apontando pra `/api/v1/health`

### 5. Plano de rollout sugerido

| Fase | Volume | Duração | Critério de avanço |
|---|---|---|---|
| **Alpha interno** | 1 tenant (Léo) | 1 semana | Zero crítico no Sentry |
| **Beta fechado** | 5 clientes hand-picked | 4 semanas | NPS > 50, churn 0 |
| **Beta aberto** | 20 clientes | 4 semanas | Performance estável |
| **GA** | 100+ | — | Marketing + sales |

### 6. Documentação ao cliente

- Centro de ajuda (Notion ou Outline) — guias por feature
- Vídeos curtos (Loom) — onboarding, primeiro pedido, primeiro fluxo
- FAQ — top 20 dúvidas previsíveis
- Canal de suporte: email/WhatsApp dedicado

### 7. Operações financeiras

- Modelo de cobrança definido (mensal por user? por empresa?)
- Forma de cobrança (boleto/Pix manual? gateway?)
- Contratos comerciais padrão

---

## 🚨 Bloqueadores conhecidos

1. **Deploy lag do frontend Railway** — bundle prod estava atrás de master
   antes da v1.5.0; forçado redeploy via commit vazio. Confirmar que
   auto-deploy está saudável.

2. **Tour de onboarding cobre roles** mas alguns steps apontam rotas que
   variam por tenant (ex: `/integracoes/omie/conectar` não existe ainda
   na sidebar OnboardingTour para DIRECTOR). Revisar antes do GA.

3. **`betinna.html`** ainda existe em `frontend/` como referência UX —
   pode confundir novos devs. Remover ou mover pra `frontend/docs/`.

---

## 🟢 Recomendação final

**GO** condicional — produto está estável o suficiente pra **Alpha
interno** imediato. Para **Beta fechado**, faltam apenas:
- Domínio próprio (`betinna.ai`) — 1 dia
- Termos + Política (advogado) — 1 semana
- Backup restore testado — 2h
- Sentry alertas — 1h

ETA Beta fechado: **2 semanas a partir de 2026-05-19**.

ETA GA aberto: **8-10 semanas** (após validação Beta).
