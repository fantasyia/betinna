# Migrations — Betinna.ai backend

> Este projeto usa Prisma Migrate em produção e `prisma db push` apenas em
> desenvolvimento local. Estado atual: **migrations versionadas + baseline
> aplicada em prod**.

---

## TL;DR

| Ambiente | Comando | Quando |
|---|---|---|
| **Dev local** | `npm run db:push` (com guard) ou `npm run db:migrate` | Iteração rápida; criar migration ao final |
| **Produção** | `npm run db:migrate:deploy` | Aplica migrations pendentes via `scripts/deploy-migrations.sh` |

---

## Estrutura

```
backend/prisma/migrations/
├── 0_init/                          # baseline (1312 LOC) — estado completo do schema
├── 20260517000000_fidelidade/
├── 20260517010000_inbox_race_unique/
├── 20260517020000_indexes_performance/
├── 20260518000000_cliente_endereco_fields/
├── 20260518010000_notificacao/
├── 20260518020000_mullerbot_persona/
├── 20260518030000_form_builder/
├── 20260518040000_nps/
├── 20260518050000_metas_segmentos/
├── 20260518060000_produto_estoque_atualizado_em/
├── 20260518070000_notif_estoque_zerado/
├── 20260518080000_pedido_origem/
├── 20260518090000_funis/
├── 20260518100000_add_is_demo_flag/   # v1.2.0 (Seed Demo)
└── migration_lock.toml
```

Cada migration é um arquivo `.sql` puro que o Prisma aplica em ordem
cronológica.

---

## Como criar nova migration

### Em desenvolvimento

```bash
# 1) Edita prisma/schema.prisma
# 2) Gera migration nomeada
cd backend
npm run db:migrate -- --name add_xxx_field

# Isso roda: prisma migrate dev --name add_xxx_field
# + atualiza schema hash em scripts/.schema-hash
```

### Convenções de nome

- `add_xxx` — adiciona campo/tabela/index
- `drop_xxx` — remove (raro, requer cuidado)
- `alter_xxx` — modifica tipo/constraint
- `rename_xxx_to_yyy` — renomeia

### Conteúdo

- **Sempre** rever o `.sql` gerado antes de commitar
- Migrations destrutivas (`DROP COLUMN`, `DROP TABLE`) precisam de plano de rollback
- Indexes grandes em tabelas grandes precisam de `CONCURRENTLY` (não suportado por Prisma puro — usar SQL custom)

---

## Como aplicar em produção

### Automático (Railway)

`scripts/deploy-migrations.sh` roda no boot do serviço `api`:

1. Verifica se `_prisma_migrations` existe no banco
2. Se DB tem domain tables mas não tem migrations table → marca `0_init` como aplicada (baseline)
3. Roda `prisma migrate deploy` (aplica pendentes em ordem)

É idempotente — pode rodar quantas vezes quiser sem causar drift.

### Manual (emergência)

```bash
# Conecta no Railway
railway run --service api bash

# Roda migrate deploy
npm run db:migrate:deploy
```

---

## Rollback

Prisma não oferece rollback automático. Procedimento manual:

1. **Backup do banco antes** (Supabase Dashboard → Backups)
2. Cria nova migration que reverte:

```bash
cd backend
npm run db:migrate -- --name revert_xxx
# Edita o .sql gerado pra fazer o DROP/inverter ALTER
```

3. Aplica em prod via deploy normal

**Nunca** delete uma migration que já foi aplicada em produção — quebra o
hash chain do `_prisma_migrations`.

---

## Smart deploy script

`scripts/deploy-migrations.sh` lida com 3 cenários:

| Cenário | Detecção | Ação |
|---|---|---|
| DB vazio | sem `_prisma_migrations` e sem domain tables | `migrate deploy` cria tudo |
| DB legado (db push) | sem `_prisma_migrations` mas tem `Usuario` | `resolve --applied 0_init` + `migrate deploy` |
| DB normal | tem `_prisma_migrations` | `migrate deploy` |

---

## Drift detection

`npm run db:check-drift` compara hash do schema com hash da última migration:

- Se hash bate → schema está em sync com migrations
- Se diferente → falta gerar migration nova (`npm run db:migrate`)

Esse comando é chamado em CI para garantir que nenhum PR esqueça de gerar
migration ao mudar schema.

---

## Drift entre prod e local

Se prod aplicou migration X e local não tem:

```bash
git pull origin main
npx prisma generate
# Não precisa rodar migrate localmente; quando subir uma feature
# que toque schema, vai pegar o novo state.
```

---

## Convenção: db push vs migrate

| Comando | Quando usar |
|---|---|
| `db:push` | ❌ **Bloqueado por guard** (`scripts/guard-db-push.js`) em prod/staging |
| `db:push:force` | ✅ Apenas dev local; sandbox iterativo |
| `db:migrate` | ✅ Após terminar iteração de schema, transforma em migration versionada |
| `db:migrate:deploy` | ✅ Boot de prod (via `deploy-migrations.sh`) |

A regra dura: **nada vai pra prod sem migration versionada**.
