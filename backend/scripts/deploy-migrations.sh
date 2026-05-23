#!/usr/bin/env bash
# =====================================================================
# Smart migrate deploy — Betinna.ai
#
# Lida com a transição "db push → migrations versionadas":
#  - DB já tem _prisma_migrations + 0_init aplicada → migrate deploy normal
#  - DB tem tables mas SEM _prisma_migrations (legado db push) →
#    resolve --applied 0_init e depois migrate deploy
#  - DB vazio → migrate deploy cria tudo
#
# Idempotente. Pode rodar quantas vezes quiser sem causar drift.
# =====================================================================

set -euo pipefail

echo "→ Verificando estado do banco…"

# Detecta se _prisma_migrations existe (DB já está sob controle de migrations)
HAS_MIGRATIONS_TABLE=$(npx -y prisma@6.19.3 db execute \
  --stdin <<<"SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations' LIMIT 1;" \
  2>/dev/null && echo "yes" || echo "no")

# Detecta se existe alguma tabela de domínio (ex: Usuario) — significa db push foi rodado
HAS_DOMAIN_TABLES=$(npx -y prisma@6.19.3 db execute \
  --stdin <<<"SELECT 1 FROM information_schema.tables WHERE table_name = 'Usuario' LIMIT 1;" \
  2>/dev/null && echo "yes" || echo "no")

if [ "$HAS_MIGRATIONS_TABLE" = "no" ] && [ "$HAS_DOMAIN_TABLES" = "yes" ]; then
  echo "→ DB legado (db push) detectado — marcando 0_init como aplicada (baseline)"
  npx -y prisma@6.19.3 migrate resolve --applied 0_init
else
  echo "→ Estado normal — vai rodar migrate deploy direto"
fi

echo "→ Aplicando migrations pendentes…"
npx -y prisma@6.19.3 migrate deploy

echo "✅ Migrations OK"
