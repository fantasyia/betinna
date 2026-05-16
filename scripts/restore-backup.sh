#!/usr/bin/env bash
# Restore backup script — desfaz um deploy aplicando o último dump conhecido.
#
# Uso:
#   ./scripts/restore-backup.sh ./backups/betinna_20260515_140000.dump
#
# Variáveis de ambiente requeridas:
#   DATABASE_URL  - connection string Postgres (target — onde restaurar)
#
# Comportamento:
#  1. Pede confirmação interativa (não há flag --force pra evitar acidente)
#  2. Drop + recreate schema public (--clean + --if-exists)
#  3. Restaura via pg_restore com -j 4 (paralelo)
#
# ⚠️ DESTRUTIVO: apaga TODOS os dados atuais antes de restaurar. Use apenas
#    quando o deploy falhou e está rollback necessário.

set -euo pipefail

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo -e "${RED}Uso: $0 <backup_file>${NC}"
  echo "Exemplo: $0 ./backups/betinna_20260515_140000.dump"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo -e "${RED}❌ Arquivo não existe: $BACKUP_FILE${NC}"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${RED}❌ DATABASE_URL não definido.${NC}"
  exit 1
fi

if ! command -v pg_restore &>/dev/null; then
  echo -e "${RED}❌ pg_restore não encontrado no PATH.${NC}"
  exit 1
fi

# Mostra info do backup
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo -e "${YELLOW}⚠️  RESTORE DESTRUTIVO${NC}"
echo "   Arquivo:     $BACKUP_FILE"
echo "   Tamanho:     $SIZE"
echo "   Target:      $DATABASE_URL"
echo ""
echo -e "${RED}   Isso vai APAGAR todos os dados atuais e substituir pelo backup.${NC}"
echo ""

# Confirmação interativa (sem --force, sem --yes — exige presença humana)
read -p "Tem certeza? Digite 'RESTAURAR' (em maiúsculas) para prosseguir: " confirm
if [ "$confirm" != "RESTAURAR" ]; then
  echo -e "${YELLOW}Abortado.${NC}"
  exit 0
fi

echo -e "${GREEN}▶ Restaurando...${NC}"

# --clean: dropa objetos antes de restaurar
# --if-exists: não falha se objeto não existe
# -j 4: 4 workers paralelos
# --no-owner --no-acl: portabilidade entre Supabase free vs pro
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --jobs=4 \
  --dbname="$DATABASE_URL" \
  --verbose \
  "$BACKUP_FILE" 2>&1 | tail -20

echo ""
echo -e "${GREEN}✅ Restore concluído.${NC}"
echo ""
echo "Próximos passos manuais:"
echo "  1. Verificar contagens-chave: psql \$DATABASE_URL -c 'SELECT COUNT(*) FROM \"Cliente\"'"
echo "  2. Rodar testes de smoke: curl https://api/health/deep"
echo "  3. Em produção: redeploy app caso schema tenha mudado"
