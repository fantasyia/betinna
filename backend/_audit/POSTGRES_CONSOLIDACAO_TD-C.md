# TD-C — Consolidação Postgres: Railway → Supabase

**Status:** 📋 Procedimento documentado · ⏳ Execução pendente
**Modelo:** Claude Opus 4.7 max
**Data:** 2026-05-16
**Trigger pra executar:** ANTES do primeiro cliente real (banco quase vazio = baixo risco)

---

## Contexto

Hoje temos **dois Postgres**:
- **Railway Postgres plugin** — banco do app (DATABASE_URL/DIRECT_URL)
- **Supabase Postgres** — armazena Auth (users do `auth.users`) e Storage

Isso gera confusão recorrente:
- SQL rodado no Supabase SQL Editor não chega no banco do app
- Backups duplicados (Railway plugin + Supabase)
- 2 lugares pra observar performance
- Custo: Railway free tier tem limite de DB; Supabase free tem 500MB já provisionado

**Decisão (D-novo):** consolidar em UM único Postgres = o do Supabase.

---

## Vantagens da consolidação

1. **SQL Editor do Supabase passa a funcionar pra debug do app**
2. **Backups gerenciados** pelo Supabase (PITR no plano Pro, daily no Free)
3. **Foreign keys cruzadas** entre `auth.users` e `public.Usuario` ficam diretas
4. **1 connection pool pra gerenciar** (PgBouncer do Supabase)
5. **Free tier do Railway sobra** pra worker/api (mais memória)

## Riscos

1. **Latência:** Supabase em região diferente do Railway pode aumentar query time
   - Mitigação: usar Supabase pooler (Transaction mode, port `6543`) que é otimizado pra serverless/edge
2. **Limite de conexões:** Supabase free tier tem 60 connections direct, mais via pooler
   - Mitigação: já usamos PgBouncer-compatible (`?pgbouncer=true`)
3. **Migração de dados existentes:** se o banco já tem produção, exige pg_dump/restore
   - Mitigação: fazer **antes do primeiro cliente real** (banco quase vazio)

---

## Procedimento (em ordem)

### 1. Validar pré-requisitos

```bash
# Confirmar projeto Supabase está acessível
psql "$SUPABASE_DIRECT_URL" -c "SELECT version();"

# Backup completo do Railway Postgres atual (defensive)
pg_dump "$RAILWAY_DATABASE_URL" \
  --no-owner --no-acl \
  --format=custom \
  --file=backup-railway-$(date +%Y%m%d-%H%M).dump

# Validar backup
pg_restore --list backup-railway-*.dump | head -50
```

### 2. Limpar Supabase Postgres (se já houver dados de teste)

```sql
-- Conectado ao Supabase SQL Editor
-- ⚠️ DESTRUTIVO — só rodar em ambiente onde dados são descartáveis
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
```

### 3. Aplicar migrations no Supabase

```bash
cd backend

# Setar temporariamente DATABASE_URL pra apontar pro Supabase
export DATABASE_URL="postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
export DIRECT_URL="postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres"

# Aplicar todas as migrations
npx prisma migrate deploy

# Verificar
psql "$DIRECT_URL" -c "\dt public.*"
```

### 4. Migrar dados (se houver)

#### Opção A — Banco quase vazio (CASO ATUAL): re-seed

```bash
# Login no Railway atual, exporta o admin user e empresa
psql "$RAILWAY_DATABASE_URL" -c "
  SELECT 'INSERT INTO \"Usuario\" VALUES (' || quote_literal(id) || ',' || ... || ');'
  FROM \"Usuario\" WHERE role = 'ADMIN';
" > admin-row.sql

# Aplica no Supabase
psql "$DIRECT_URL" < admin-row.sql

# Re-roda o seed-demo se quiser dados de exemplo
curl -X POST https://api-<railway>.up.railway.app/api/v1/auth/seed-demo \
  -H "Authorization: Bearer $BOOTSTRAP_TOKEN" \
  -d '{"force": false}'
```

#### Opção B — Dados de produção: pg_dump + pg_restore

```bash
# Dump apenas dados (estrutura já está pelas migrations)
pg_dump "$RAILWAY_DATABASE_URL" \
  --data-only \
  --schema=public \
  --exclude-table=_prisma_migrations \
  --format=custom \
  --file=data.dump

# Restore
pg_restore \
  --data-only \
  --no-owner --no-acl \
  --disable-triggers \
  --dbname="$DIRECT_URL" \
  data.dump

# Verificar contagens
for tbl in Usuario Empresa Cliente Produto Pedido Lead; do
  echo -n "$tbl: "
  psql "$DIRECT_URL" -tAc "SELECT COUNT(*) FROM \"$tbl\";"
done
```

### 5. Atualizar variáveis no Railway

No dashboard Railway, em **cada service** (api, worker):

| Variável | Antes (Railway plugin) | Depois (Supabase) |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | `${{Postgres.DATABASE_URL}}` | `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres` |

⚠️ **NÃO usar** as URLs do Supabase dashboard "Project Settings → Database" → connection string `direct`. Elas têm IPv6 que Railway não suporta. Use **pooler** (IPv4).

### 6. Validar com smoke test

```bash
# Após deploy automático completar
curl https://api-<railway>.up.railway.app/api/v1/health

# Login do admin
curl -X POST "https://<supabase-ref>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@betinna.ai","password":"Betinna@2026"}' | jq .access_token

# Endpoint autenticado
curl https://api-<railway>.up.railway.app/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### 7. Desativar Railway Postgres plugin

Após 1 semana de operação estável no Supabase:

1. Railway dashboard → Postgres plugin → **Settings → Remove**
2. ⚠️ Confirma que o backup `.dump` ainda está acessível (cópia local + cloud backup)

---

## Reversão (rollback) — se algo der errado

1. No Railway, reverter `DATABASE_URL` e `DIRECT_URL` pras `${{Postgres.DATABASE_URL}}`
2. Restart de api + worker
3. Validar smoke test contra o banco antigo
4. Investigar o problema antes de tentar de novo

**RTO esperado:** < 5 minutos (mudança de env var + restart automático)

---

## Checklist final

- [ ] Backup Railway feito e validado (`pg_restore --list` mostra todas tabelas)
- [ ] Migrations rodam limpo no Supabase (`prisma migrate deploy` exit 0)
- [ ] Dados migrados / re-seedados (contagens batem)
- [ ] Variáveis Railway atualizadas (DATABASE_URL + DIRECT_URL apontando pro Supabase)
- [ ] Smoke test passou (health + login + auth/me)
- [ ] 1 semana de operação estável sem rollback
- [ ] Plugin Railway Postgres removido
- [ ] Doc atualizado em `_audit/SPRINT1_HARDENING_2026-05-16.md` marcando TD-C como done

---

## Custos

| Item | Railway plugin | Supabase Free | Supabase Pro |
|---|---|---|---|
| Storage | $5/mo (1GB) | 500MB free | 8GB ($25/mo) |
| Conexões | ~100 direct | 60 direct + pooler | 200 direct + pooler |
| Backups | Manual | Daily 7d | PITR + daily 30d |
| SQL Editor | Não | ✅ Sim | ✅ Sim |

Pra MVP (~10 empresas, banco < 1GB) o Supabase Free atende. Upgrade pra Pro
quando passar de 500MB ou precisar de PITR.
