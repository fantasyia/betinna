# DEPLOY — Betinna.ai

Guia operacional para colocar a stack em produção no Railway + Supabase.

> CI/CD já está pronto em `.github/workflows/ci.yml`. Este documento descreve
> os passos manuais de bootstrap + secrets + verificação que precisam acontecer
> **uma vez** antes do primeiro deploy automático.

---

## 1. Stack alvo

| Serviço         | Provedor   | Função                                                   |
| --------------- | ---------- | -------------------------------------------------------- |
| `api`           | Railway    | NestJS HTTP — porta exposta, healthcheck `/api/v1/health` |
| `worker`        | Railway    | Mesma imagem do api, mas `npm run worker` (BullMQ + crons)|
| `frontend`      | Railway    | Vite build → `serve dist` static                          |
| Postgres        | Supabase   | DB principal (pooler 6543)                                |
| Auth + Storage  | Supabase   | JWT (RS256) + Storage (10MB)                              |
| Redis           | Railway    | BullMQ + throttler                                        |

Razão de **2 serviços Node** (api + worker): API escala horizontal (stateless),
worker é singleton (WhatsApp Baileys + cron locks). Mesma imagem Docker — só
muda `startCommand`.

---

## 2. Bootstrap inicial (uma vez)

### 2.1 — Supabase

1. Criar projeto em https://supabase.com
2. Anotar do dashboard:
   - `Project URL` → `SUPABASE_URL`
   - `anon key` → `SUPABASE_ANON_KEY`
   - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT secret` (Settings → API → JWT Settings) — opcional, auto-detectado HS256/RS256
   - `Database URL` (Settings → Database → Connection string → Transaction mode) → `DATABASE_URL`
3. Em **SQL Editor**, rodar:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ```

4. Storage → criar buckets: `documentos`, `produtos`, `whatsapp-media` (todos privados, signed URLs).

### 2.2 — Railway

1. Criar projeto novo
2. **Add service → Database → Redis** → anotar `REDIS_URL` (rediss:// em prod)
3. **Add service → GitHub repo (Betinna.ai)** 3x:
   - Service `api`: Root dir `/backend`, `railway.toml` lido automaticamente
   - Service `worker`: Root dir `/backend`, em **Settings → Service**, mudar Custom Config Path para `railway.worker.toml`
   - Service `frontend`: Root dir `/frontend`, `railway.toml` lido automaticamente

### 2.3 — Variáveis de ambiente (Railway)

Aplicar em cada service. Os valores entre `<>` são placeholders.

**Comum (api + worker):**

```
NODE_ENV=production
DATABASE_URL=<supabase transaction pooler>
DIRECT_URL=<supabase direct connection>
SUPABASE_URL=https://<id>.supabase.co
SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service>
ENCRYPTION_KEY=<64 hex chars — gerar com `openssl rand -hex 32`>
REDIS_URL=<railway redis url>
LOG_LEVEL=info
OMIE_DEMO_MODE=false
OMIE_PRECO_FABRICA_RATIO=0.7
```

**Específicos do worker:**

```
SERVICE_TYPE=worker
```

**Específicos do frontend:**

```
VITE_API_URL=https://<api-domain>.up.railway.app
VITE_SUPABASE_URL=https://<id>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon>
```

**Integrações (opcionais, podem ficar vazias até onboarding do cliente):**

```
OMIE_WEBHOOK_SECRET=<gerar>
ML_WEBHOOK_IP_WHITELIST=54.94.78.10,...
META_GRAPH_APP_SECRET=<>
META_GRAPH_VERIFY_TOKEN=<>
GOOGLE_OAUTH_CLIENT_ID=<>
GOOGLE_OAUTH_CLIENT_SECRET=<>
SHOPEE_PARTNER_KEY=<>
TIKTOK_APP_KEY=<>
TIKTOK_APP_SECRET=<>
AMAZON_LWA_CLIENT_ID=<>
AMAZON_LWA_CLIENT_SECRET=<>
```

> **Validação automática:** `EnvService.auditProductionReadiness()` roda no
> `main.ts` e ABORTA o boot em prod se `ENCRYPTION_KEY` for trivial
> (zeros/sequência/repetição). Aviso em dev, abort em prod.

### 2.4 — Aplicar migrations (primeira vez)

Migration baseline `0_init` + a nova `20260517000000_fidelidade`. O CI roda
isso automaticamente via `scripts/deploy-migrations.sh`, mas a primeira vez
você pode disparar manualmente:

```powershell
cd backend
$env:DATABASE_URL = "<supabase direct url>"
npx prisma migrate deploy
```

Se o DB já tinha tabelas (legacy `db push`), o script detecta e roda
`migrate resolve --applied 0_init` antes do deploy.

### 2.5 — Seed inicial (1x)

```powershell
$env:DATABASE_URL = "<supabase>"
$env:SUPABASE_URL = "<>"
$env:SUPABASE_SERVICE_ROLE_KEY = "<>"
npm run db:seed
```

Cria usuário ADMIN (`admin@betinna.ai` / `Betinna@2026`) — **trocar senha
imediatamente** via Supabase Auth dashboard.

---

## 3. CI/CD — GitHub Secrets necessários

Aba **Settings → Secrets and variables → Actions** no repo `fantasyia/MSM_alimentos`:

| Secret                    | Origem                                                   | Habilita     |
| ------------------------- | -------------------------------------------------------- | ------------ |
| `RAILWAY_TOKEN`           | Railway → Account → Tokens                                | Job `deploy` |
| `E2E_BASE_URL`            | URL pública do frontend (Railway)                         | Job `e2e`    |
| `E2E_API_URL`             | URL pública da API (Railway) — também usada no healthcheck do deploy | Job `e2e` + healthcheck |
| `E2E_TEST_EMAIL_ADMIN`    | Email de um user ADMIN no Supabase de staging             | E2E          |
| `E2E_TEST_EMAIL_DIRETOR`  | idem (DIRECTOR)                                           | E2E          |
| `E2E_TEST_EMAIL_GERENTE`  | idem (GERENTE)                                            | E2E          |
| `E2E_TEST_EMAIL_REP`      | idem (REP)                                                | E2E          |
| `E2E_TEST_PASSWORD`       | Senha compartilhada dos users de teste                    | E2E          |

> **Sem `RAILWAY_TOKEN`**: jobs `deploy` são *pulados* (não falham). CI fica
> verde, mas nada vai pro Railway. Setar quando staging estiver pronto.
>
> **Sem `E2E_*`**: jobs `e2e` são pulados. Igual.

---

## 4. Pipeline (push pra `main`)

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ backend      │   │ frontend     │   │ check-secrets│
│ lint+test+   │   │ lint+typecheck+│ │ gate flags   │
│ build        │   │ build+lighthouse│ │              │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────┬───────┴──────────────────┘
                  ▼
        ┌────────────────────┐    ┌─────────────────┐
        │ e2e (opcional)     │    │ deploy (opcional)│
        │ Playwright staging │    │ Railway api +    │
        │                    │    │ worker + front   │
        └────────────────────┘    └─────────────────┘
                                          │
                                          ▼
                                  Migration deploy
                                  via deploy-migrations.sh
```

Deploy **não depende** de E2E (gate solto durante bootstrap). Quando E2E estiver
estável, mover `e2e` de volta pra `deploy.needs` em `ci.yml`.

---

## 5. Rollback

### Deploy ruim no Railway:

```
railway rollback --service api
railway rollback --service worker
railway rollback --service frontend
```

Railway guarda os últimos 5 deploys por service.

### Migration ruim:

```sql
-- No Supabase SQL editor:
DELETE FROM _prisma_migrations WHERE migration_name = '<migration-ruim>';
-- E rodar SQL reverso manualmente.
```

> ⚠️ **Nunca** rodar `prisma migrate reset` em produção. Apaga todos os dados.

---

## 6. Healthchecks pós-deploy

| Endpoint                                  | Esperado                                |
| ----------------------------------------- | --------------------------------------- |
| `GET <api>/api/v1/health`                 | `{ status: "ok", uptime, db: "ok" }`    |
| `GET <api>/docs`                          | Swagger UI                              |
| `GET <frontend>/`                         | App carrega, tela de login              |
| `GET <frontend>/login` → submit credenciais | Cookie `refresh_token` setado, redirect dashboard |

Smoke test manual após cada deploy:

```bash
curl -fsS $API_URL/api/v1/health | jq .status   # → "ok"
curl -fsS $FRONTEND_URL/                          # → 200
```

---

## 7. Operações comuns

### Re-rodar migrations manual:

```
railway run --service api bash scripts/deploy-migrations.sh
```

### Reiniciar worker (clear BullMQ stalled jobs):

Railway dashboard → service `worker` → Deployments → Restart.

### Tail de logs:

```
railway logs --service api
railway logs --service worker
```

### Backup do DB:

GitHub Actions `backup.yml` roda diariamente — dump `pg_dump` → artifact (7d retention).
Para backup manual:

```
pg_dump -Fc $DATABASE_URL > backup-$(date +%Y%m%d).dump
```

---

## 8. Checklist pré-go-live

- [ ] `ENCRYPTION_KEY` gerada com `openssl rand -hex 32` e armazenada em
      gerenciador de segredos do cliente (não em texto plano em chat)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` setada APENAS no backend (`api` + `worker`),
      **NUNCA** no frontend
- [ ] Senha do `admin@betinna.ai` trocada via Supabase Auth dashboard
- [ ] `OMIE_DEMO_MODE=false` em prod (default `true` é só pra dev)
- [ ] Webhooks Meta/ML/Shopee/Amazon/TikTok cadastrados com a URL pública da API
- [ ] DNS custom domain configurado (Railway → Settings → Networking)
- [ ] HTTPS forçado (Railway faz redirect automático)
- [ ] CORS `CORS_ORIGIN` apontando para o domínio do frontend
- [ ] Backup automático ativo (`backup.yml` workflow rodando)
- [ ] Sentry DSN configurado (`SENTRY_DSN` em api + worker — opcional, mas
      altamente recomendado pra observabilidade)

---

## 9. Estrutura de arquivos relevante

```
.github/workflows/
  ci.yml              # backend + frontend + e2e + deploy (este é o principal)
  backup.yml          # dump diário pg_dump
  release.yml         # tags semânticas + changelog
  security.yml        # npm audit semanal

backend/
  Dockerfile
  railway.toml        # service api
  railway.worker.toml # service worker
  scripts/
    deploy-migrations.sh   # smart baseline-aware migrate deploy
    check-migration-drift.js  # hash check no CI
    update-schema-hash.js  # rodado por db:migrate
    guard-db-push.js       # bloqueia db:push acidental
  prisma/migrations/
    .schema-hash      # SHA-256 do schema (drift detection)
    0_init/
    20260517000000_fidelidade/

frontend/
  railway.toml
  vite.config.ts
  playwright.config.ts
```
