#!/usr/bin/env bash
# Pre-deploy backup script — captura snapshot completo do estado antes de
# aplicar mudanças que possam ser destrutivas (migrations, db:push --accept-data-loss).
#
# Uso:
#   ./scripts/backup-pre-deploy.sh
#
# Variáveis de ambiente requeridas:
#   DATABASE_URL  - connection string Postgres (Supabase ou self-hosted)
#   REDIS_URL     - connection string Redis (opcional, mas recomendado)
#
# Saída: arquivo em ./backups/betinna_YYYYMMDD_HHMMSS.dump

set -euo pipefail

# Cores para output legível
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Validar env vars críticos
if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${RED}❌ DATABASE_URL não definido. Defina e tente novamente.${NC}"
  echo "   Ex: export DATABASE_URL='postgresql://user:pass@host:5432/db'"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ─── Postgres ────────────────────────────────────────────────────────────
DB_FILE="$BACKUP_DIR/betinna_${TIMESTAMP}.dump"
echo -e "${GREEN}📦 Pre-deploy backup: $TIMESTAMP${NC}"
echo "   → Postgres dump (custom format, comprimido)"

# pg_dump com -Fc = custom format (suporta restore parcial), -Z9 = max compression
if ! command -v pg_dump &>/dev/null; then
  echo -e "${RED}❌ pg_dump não encontrado no PATH. Instale postgresql-client.${NC}"
  exit 1
fi

pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --verbose \
  --file="$DB_FILE" 2>&1 | grep -E "(reading|dumping|saving)" | tail -5 || true

DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
echo -e "${GREEN}   ✅ Postgres dump: $DB_FILE ($DB_SIZE)${NC}"

# ─── Redis (opcional, best-effort) ───────────────────────────────────────
if [ -n "${REDIS_URL:-}" ]; then
  echo "   → Redis BGSAVE (snapshot async)"
  if command -v redis-cli &>/dev/null; then
    redis-cli -u "$REDIS_URL" BGSAVE 2>/dev/null && \
      echo -e "${GREEN}   ✅ Redis BGSAVE iniciado (snapshot escrito pelo próprio Redis)${NC}" || \
      echo -e "${YELLOW}   ⚠️  Redis BGSAVE falhou — não é crítico (BullMQ jobs são recuperáveis via DB)${NC}"
  else
    echo -e "${YELLOW}   ⚠️  redis-cli não encontrado — pulando snapshot Redis${NC}"
  fi
else
  echo -e "${YELLOW}   ⚠️  REDIS_URL não definido — pulando snapshot Redis${NC}"
fi

# ─── Limpa backups antigos (retention) ────────────────────────────────────
echo "   → Limpando backups com mais de $RETENTION_DAYS dias"
find "$BACKUP_DIR" -name "betinna_*.dump" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# ─── Resumo final ────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✅ Backup completo${NC}"
echo "   Arquivo:  $DB_FILE"
echo "   Tamanho:  $DB_SIZE"
echo "   Restore:  ./scripts/restore-backup.sh $DB_FILE"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANTE: mantenha este arquivo até o deploy ser verificado estável.${NC}"
echo -e "${YELLOW}    Para staging, mantenha 7 dias. Para produção, mantenha 30 dias.${NC}"
