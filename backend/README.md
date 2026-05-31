# Betinna.ai · Backend

API REST e camada de domínio da plataforma comercial Betinna.ai.

**Stack:**
- NestJS 11 + TypeScript estrito
- Prisma 6 + PostgreSQL (Supabase)
- Supabase Auth (JWT) + Storage
- BullMQ + Redis (jobs)
- Pino (logs estruturados)
- Zod (validação)
- Vitest (testes)
- Swagger/OpenAPI (docs)
- Helmet + Throttler (segurança)

---

## Setup local

### 1. Pré-requisitos
- Node.js ≥ 22
- PostgreSQL (via Supabase, já configurado)
- Redis local opcional (`docker run -d -p 6379:6379 redis:7-alpine`)

### 2. Instalar dependências
```powershell
cd C:\Users\Dell\dev\betinna\backend
npm install
```

### 3. Variáveis de ambiente
```powershell
Copy-Item .env.example .env.local
```
Edite `.env.local` preenchendo:
- `DATABASE_URL` / `DIRECT_URL` (Supabase Postgres)
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` (Settings → API → JWT Settings)
- `ENCRYPTION_KEY` (gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

### 4. Banco
```powershell
npm run db:generate    # gera Prisma Client
npm run db:push        # cria tabelas no Postgres
npm run db:seed        # admin inicial + permissões padrão
```

### 5. Rodar
```powershell
npm run start:dev
```
- API: http://localhost:3001/api/v1
- Swagger: http://localhost:3001/docs
- Health: http://localhost:3001/api/v1/health

### 6. Login do admin (criado pelo seed)
- e-mail: `admin@betinna.ai`
- senha: `Betinna@2026`

Para autenticar, faça login via Supabase Auth (frontend) e use o `access_token` no header:
```
Authorization: Bearer <jwt>
```

---

## Estrutura

```
src/
├── config/               # Validação de env + EnvService
├── database/             # PrismaService + PrismaModule
├── shared/               # Erros, filters, interceptors, decorators, utils, types, pipes
│   ├── decorators/       # @Public, @Roles, @RequirePermissions, @CurrentUser, @Audit
│   ├── errors/           # AppException, ErrorCode
│   ├── filters/          # AllExceptionsFilter (resposta padronizada)
│   ├── interceptors/     # ResponseInterceptor (envelope success)
│   ├── pipes/            # ZodValidationPipe
│   ├── types/            # AuthenticatedUser, Paginated
│   └── utils/            # CryptoUtil, RequestIdMiddleware
├── modules/
│   ├── auth/             # SupabaseAuthService + Guards (Auth/Roles/Permissions)
│   ├── audit/            # AuditService + AuditInterceptor
│   ├── empresas/         # CRUD multi-tenant
│   ├── health/           # /health
│   ├── permissions/      # RBAC granular (matriz Role × Módulo × Ação)
│   └── users/            # CRUD com integração Supabase Auth
├── integrations/         # (futuro) OMIE, WhatsApp, Marketplaces
├── jobs/                 # (futuro) BullMQ workers
├── app.module.ts
└── main.ts
```

---

## Padrões de código

- **Controllers** só lidam com HTTP. Regra de negócio → Service.
- **Services** são focados, recebem DTOs validados.
- **Repositórios** = Prisma direto (não criamos camada extra, mas isolamos queries complexas em métodos).
- **DTOs** = schemas Zod no arquivo `*.dto.ts` do módulo.
- **Erros** = sempre `AppException` (ou subclasses) → resposta padronizada.
- **Permissões** = `@Roles(...)` ou `@RequirePermissions({ module, action })`.
- **Auditoria** = `@Audit({ action, resource })` em endpoints sensíveis.

### Resposta padrão de sucesso
```json
{
  "success": true,
  "data": { ... },
  "meta": { "path": "/api/v1/users", "method": "GET", "timestamp": "...", "requestId": "uuid" }
}
```

### Resposta de erro
```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] },
  "meta": { ... }
}
```

### Paginação (em listagens)
```json
{
  "success": true,
  "data": {
    "data": [...],
    "pagination": { "page": 1, "limit": 20, "total": 142, "totalPages": 8 }
  },
  "meta": { ... }
}
```

---

## Multi-tenant

- O usuário pode pertencer a **uma ou mais empresas** (M:N via `UsuarioEmpresa`).
- Header `X-Empresa-Id` define a empresa ativa na requisição.
- Se omitido, usa a primeira empresa do usuário.
- Tentar acessar empresa que o usuário não tem vínculo → `403 TENANT_ACCESS_DENIED`.
- Todos os repositórios devem filtrar por `empresaId = user.empresaIdAtiva`.

---

## Scripts

```powershell
npm run start:dev        # dev com hot-reload
npm run start:debug      # dev com inspector
npm run build            # build de produção
npm run start:prod       # roda dist/
npm run lint             # ESLint
npm run format           # Prettier
npm run typecheck        # tsc --noEmit
npm run test             # vitest
npm run test:watch       # vitest watch
npm run test:cov         # cobertura
npm run db:generate      # Prisma Client
npm run db:push          # aplica schema
npm run db:migrate       # cria migration
npm run db:studio        # Prisma Studio
npm run db:seed          # admin + permissões
```

---

## Deploy (Railway)

1. Conectar repo GitHub no painel Railway
2. Criar 2 serviços: **Node** + **Redis**
3. Setar variáveis de ambiente (mesmas do `.env.local`)
4. `npm run db:migrate:deploy` no release command
5. Start command: `npm run start:prod`

---

## Operações

### 💾 Backup automático do banco
- Cron **`backup-diario`** roda **todos os dias às 03:00 UTC** (00:00 BRT) no serviço **Worker**.
- Faz `pg_dump` (formato custom comprimido) → sobe pro **Supabase Storage**, bucket privado **`db-backups`**, por mês: `db-backups/2026-05/betinna-<timestamp>.dump`.
- **Retenção:** apaga backups com mais de **30 dias** (configurável).
- **Em falha:** e-mail de alerta + Sentry. Se quebrar, você é avisado — não precisa monitorar.
- `pg_dump`/`pg_restore` já vêm na imagem Docker (`postgresql-client`).

| Env | Default | Pra quê |
|---|---|---|
| `BACKUP_ENABLED` | `true` | Liga/desliga o backup diário. |
| `BACKUP_RETENTION_DAYS` | `30` | Dias que cada backup fica guardado. |
| `BACKUP_ALERT_EMAIL` | *(vazio)* | E-mail do alerta de falha. Vazio = 1º ADMIN ativo. |
| `RESTORE_TEST_DATABASE_URL` | *(vazio)* | Sandbox pro teste de restauração real. Vazio = só valida integridade. |

**Rodar manualmente (emergência):**
```bash
npx tsx scripts/backup-to-storage.ts      # gera + sobe um backup agora
```
**Testar que o último backup é válido (sem tocar produção):**
```bash
npx tsx scripts/restore-test.ts           # valida integridade do último backup
```
**Restaurar de verdade (desastre):** baixe o `.dump` do bucket e rode
```bash
pg_restore --clean --if-exists --no-owner --no-acl --dbname "<URL_DESTINO>" betinna-....dump
```

### 🔭 Observabilidade (Sentry)
O Sentry já está no código; só **liga** quando o DSN está no ambiente (sem DSN = modo silencioso, não quebra nada).

| Onde | Variável | Observação |
|---|---|---|
| Backend (Railway → **api** e **worker**) | `SENTRY_DSN` | Lê em runtime. |
| Frontend (Railway → **frontend**) | `VITE_SENTRY_DSN` | Congelada no build — após setar, **redeploy** do frontend. |

**Validar:**
- Backend: `GET /api/v1/health/__sentry_test` (ADMIN) força um erro que deve cair no Sentry.
- Frontend: no console do navegador, `await window.__BETINNA_TEST_SENTRY__()`.

---

## Próximos módulos

### Core comercial (Fase 2-5)
- [ ] Clientes (CRUD + filtros + listas dinâmicas)
- [ ] Produtos + Catálogo Rep + Preços negociados
- [ ] Pedidos + Aprovação de Desconto
- [ ] Propostas + Comissões + Amostras
- [ ] Leads (Kanban)
- [ ] Ocorrências
- [ ] Inbox (WhatsApp Business)
- [ ] Marketplaces (ML → Shopee → Amazon → TikTok)
- [ ] Integração OMIE
- [ ] MullerBot (OpenAI + RAG)
- [ ] Fluxos (workflow engine)
- [ ] Agenda + Google Calendar
- [ ] Relatórios + KPIs
