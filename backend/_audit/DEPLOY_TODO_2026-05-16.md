# Deploy & CI/CD — Estado e pendências (2026-05-16)

Este documento centraliza o que **funciona automaticamente** hoje, o que precisa
de **ação humana** no Railway/GitHub, e o **tech debt** que ficou propositalmente
deferido pra não travar o desenvolvimento.

---

## ✅ O que já funciona automaticamente

Cada push em `main` dispara:

1. **`backend`** — typecheck + vitest + build (Redis ephemeral em GitHub Actions)
2. **`frontend`** — typecheck + vite build + Lighthouse (não bloqueante)
3. **`check-secrets`** — verifica quais secrets estão disponíveis
4. **`e2e`** (condicional) — Playwright contra staging, **só se** `E2E_*` setados
5. **`deploy`** (condicional) — Railway deploy, **só se** `RAILWAY_TOKEN` setado

**Status atual:** Sem secrets configurados, os jobs `e2e` e `deploy` são pulados
gracilmente (CI verde). Backend + frontend continuam validados a cada push.

---

## 🧑 Ações humanas necessárias (em ordem)

### 1. GitHub Secrets — 5 minutos

Vá em **`fantasyia/betinna` → Settings → Secrets and variables → Actions →
New repository secret**. Adicione:

| Secret | Onde pegar | Obrigatório? |
|---|---|---|
| `RAILWAY_TOKEN` | Railway → Account Settings → Tokens → Create Token | **Sim — ativa deploy** |
| `E2E_API_URL` | Railway dashboard → API service → Settings → Networking → Public domain | Quando tiver staging |
| `E2E_BASE_URL` | Railway dashboard → Frontend service → Settings → Networking → Public domain | Quando tiver E2E |
| `E2E_TEST_EMAIL_ADMIN` | `admin@betinna.ai` (do seed) | Quando tiver E2E |
| `E2E_TEST_EMAIL_DIRETOR` | (opcional — pode reusar admin no início) | Quando tiver E2E |
| `E2E_TEST_EMAIL_GERENTE` | (opcional) | Quando tiver E2E |
| `E2E_TEST_EMAIL_REP` | (opcional) | Quando tiver E2E |
| `E2E_TEST_PASSWORD` | `Betinna@2026` (senha do seed) | Quando tiver E2E |

**Mínimo absoluto pra ter auto-deploy funcionando:** só o `RAILWAY_TOKEN`. Os
`E2E_*` podem vir depois quando você quiser gate por E2E.

### 2. Criar service `worker` no Railway

Hoje só a API está rodando. O Worker (BullMQ — fluxos de automação, sync OMIE,
ML cron, etc.) precisa ser criado:

1. Railway dashboard → **+ New** → **Empty Service**
2. **Settings → Source** → conecta ao repo `fantasyia/betinna`, branch `main`
3. **Settings → Build** → "Config-as-code path" = `backend/railway.worker.toml`
4. **Settings → Service name** = `worker` (exato — matchando `--service worker` no workflow)
5. **Variables** → copia as mesmas do API service (DATABASE_URL, REDIS_URL,
   SUPABASE_*, ENCRYPTION_KEY etc.) e adiciona:
   - `SERVICE_TYPE=worker`

### 3. Criar service `frontend` no Railway

1. Railway dashboard → **+ New** → **Empty Service**
2. **Settings → Source** → mesmo repo + branch
3. **Settings → Build** → "Root directory" = `frontend/`
4. **Settings → Service name** = `frontend`
5. **Variables**:
   - `VITE_API_URL` = URL pública do service `api` (ex: `https://api-xxx.up.railway.app`)
   - `VITE_SUPABASE_URL` = (mesmo do backend)
   - `VITE_SUPABASE_ANON_KEY` = (mesmo do backend)
6. **Settings → Networking → Generate Domain** pra ter URL pública

### 4. (Opcional) UptimeRobot

`docs/monitoring.md` tem o setup. 2 monitores HTTP — API health e frontend.

---

## 🔧 Tech debt deferido (REVISITAR depois)

### TD-1 — Workflow CI deploy não depende de E2E

**Onde:** `.github/workflows/ci.yml` → job `deploy.needs: [check-secrets, backend, frontend]`

**Por quê foi feito:** Sem secrets E2E configurados, o gate de E2E bloquearia deploy.

**Quando reverter:** Assim que tiver pelo menos um usuário de teste por papel
(ADMIN/DIRETOR/GERENTE/REP) configurado no Supabase Auth + secrets `E2E_*`
no GitHub.

**Como reverter:** Mudar `deploy.needs` pra `[check-secrets, backend, frontend, e2e]`
e o `if` pra incluir `needs.e2e.result == 'success'`.

### TD-2 — Migration baseline `0_init` precisa de `migrate resolve` na primeira execução

**Onde:** `backend/prisma/migrations/0_init/migration.sql` + `backend/scripts/deploy-migrations.sh`

**Por quê foi feito:** O Railway Postgres atual foi criado via `prisma db push`
(não migrations versionadas). Rodar `prisma migrate deploy` direto causaria
drift / tentaria recriar tabelas existentes.

**O que o script faz hoje (idempotente, safe):**
- Verifica se `_prisma_migrations` existe
- Se NÃO (legado db push): roda `prisma migrate resolve --applied 0_init`
  (marca a baseline como já aplicada sem rodar SQL)
- Depois roda `prisma migrate deploy` normalmente

**Quando reverter pra `migrate deploy` direto:** Após o primeiro deploy
automatizado executar com sucesso (que vai marcar a 0_init como aplicada).
A partir daí novas migrations são `prisma migrate dev` no laptop +
`prisma migrate deploy` em CI — fluxo padrão.

**Risco:** Se o operador rodar `prisma db push` de novo em prod por engano,
volta a divergir do controle de migrations. **Regra:** depois desse cutover,
**nunca mais rodar `db push` em produção**.

### TD-3 — Migration de mudanças de schema novas

**A partir de agora**, qualquer alteração em `prisma/schema.prisma` precisa de:

```bash
cd backend
npx prisma migrate dev --name nome_descritivo_da_mudanca
# Isso gera prisma/migrations/<timestamp>_nome_descritivo/migration.sql
git add prisma/migrations/
git commit -m "feat(db): <descrição>"
git push
# CI vai rodar prisma migrate deploy via deploy-migrations.sh automaticamente
```

**NUNCA** rodar `db push` em produção. `db push` continua sendo OK em dev local
(ambiente descartável), mas NUNCA em CI / Railway / Supabase de produção.

### TD-4 — Frontend `serve` está usando `npx serve` (dep transient)

**Onde:** `frontend/railway.toml` → `startCommand = "npx serve dist -l ${PORT:-4173} -s"`

**Risco:** `npx serve` baixa o pacote `serve` toda vez que o container reinicia.
Adiciona latência de boot.

**Como melhorar:** Adicionar `serve` como devDependency do frontend e usar
`./node_modules/.bin/serve` no startCommand. Ou migrar pra container Nginx
multi-stage (mais robusto, mas mais complexo).

**Quando fazer:** Quando boot do frontend começar a ser lento perceptível
(>30s), ou antes de ir pra produção real.

### TD-5 — Frontend não usa CDN (Railway serve estático)

**Por quê:** Railway static hosting é OK pro MVP. Pra produção real, considerar
mover assets pra Cloudflare R2 / Vercel Edge.

**Trigger pra mover:** Quando latência percebida > 1s no first paint,
ou quando passar de 10k usuários ativos.

### TD-6 — `eslint.config.js` faltando no frontend

**Onde:** Build do frontend OK, mas `npm run lint` falha porque eslint 9
requer `eslint.config.js` em vez do legado `.eslintrc.*`.

**Não bloqueia deploy** (lint não está no CI), mas merece consertar quando
sobrar tempo. Migração rápida via `npx @eslint/migrate-config`.

### TD-7 — `SUPABASE_JWT_SECRET` opcional

**Onde:** `backend/.env.local` tem vazio; backend cai pro JWKS remoto.

**Risco:** JWKS remoto pode estar instável em planos free do Supabase.

**Como resolver:** Supabase dashboard → Settings → API → JWT Settings →
copiar `JWT Secret` → setar em Railway API service variables.

---

## 🔮 Fluxo de trabalho daqui pra frente

Assumindo **passo 1 e 2 do checklist humano feitos** (RAILWAY_TOKEN setado +
service worker criado):

1. Você (ou eu) edita código local
2. `git push origin main`
3. CI roda automaticamente:
   - `backend` + `frontend` (typecheck/test/build) — sempre
   - `deploy` — se RAILWAY_TOKEN presente → builda imagens Docker, sobe pro
     Railway, roda migrations idempotentes, deploya worker e frontend
4. Smoke test: `curl https://<api-domain>/api/v1/health` → `{success:true}`
5. Frontend já está atualizado, sem ação manual

**Tempo total push → produção:** ~6-8 minutos (typecheck 1min, test 1min,
build 2min, Docker build + push 2min, Railway boot 1min).

---

## ❓ Quando me pedir cada ação humana

- **AGORA, antes de continuarmos dev:**
  - [ ] Criar `RAILWAY_TOKEN` e adicionar ao GitHub Secrets
  - [ ] Criar service `worker` no Railway
  - [ ] Criar service `frontend` no Railway + setar `VITE_API_URL`

- **QUANDO QUISER E2E AUTOMÁTICO:**
  - [ ] Criar usuários de teste no Supabase Auth (1 por papel)
  - [ ] Setar secrets `E2E_*` no GitHub

- **ANTES DO PRIMEIRO CLIENTE REAL:**
  - [ ] Reverter TD-1 (gate por E2E)
  - [ ] Confirmar que TD-2 cutover já aconteceu (zero `db push` em prod)
  - [ ] Implementar TD-4 (serve sem npx)
  - [ ] Resolver TD-7 (SUPABASE_JWT_SECRET)
  - [ ] Configurar UptimeRobot

- **A MÉDIO PRAZO (quando aparecer dor):**
  - [ ] TD-5 (CDN pro frontend)
  - [ ] TD-6 (eslint config)
