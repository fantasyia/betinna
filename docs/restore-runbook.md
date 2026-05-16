# 🚨 Restore Runbook · Betinna.ai

**Quando usar:** quando o DB de produção está em estado inconsistente e a única
recuperação possível é restaurar a partir de um backup.

**⚠️ DESTRUTIVO.** Restore APAGA todos os dados atuais e substitui pelo backup.
Antes de seguir, **considere alternativas:**

- Bug específico → reverter migration via `prisma migrate resolve --rolled-back`
- Dados perdidos numa tabela → restore SÓ daquela tabela (partial restore)
- Mudança recente sem dano de schema → script SQL pra fix targeted

Restore completo só faz sentido em **catastrophic data loss** ou **migration corrompida**.

---

## Pré-requisitos

| | |
|---|---|
| Backup file | Em S3 bucket `s3://${S3_BUCKET}/daily/betinna_YYYYMMDD_HHMMSS.dump` |
| Credenciais S3 | `S3_ACCESS_KEY` + `S3_SECRET_KEY` (mesmas do GH Actions backup) |
| Railway Postgres acessível | DATABASE_URL externa configurada |
| `pg_restore` instalado | `apt install postgresql-client` ou `brew install libpq` |
| `awscli` instalado | `pip install awscli` |
| Tempo estimado | 10-30min (depende do tamanho do dump) |
| Aprovação | **DIRETOR** explícita via Slack/email — restore destrutivo |

---

## Passo 1 — Listar backups disponíveis

```bash
aws s3 ls "s3://$S3_BUCKET/daily/" \
  --endpoint-url "$S3_ENDPOINT" \
  --region "$S3_REGION"
```

Saída esperada:
```
2026-05-15 03:00:12  12345678 betinna_20260515_030000.dump
2026-05-14 03:00:11  12298765 betinna_20260514_030000.dump
...
```

Escolha o backup MAIS RECENTE que precede o incidente.

---

## Passo 2 — Baixar o backup

```bash
TIMESTAMP=20260515_030000  # ajuste conforme escolha
aws s3 cp \
  "s3://$S3_BUCKET/daily/betinna_${TIMESTAMP}.dump" \
  ./betinna_${TIMESTAMP}.dump \
  --endpoint-url "$S3_ENDPOINT"

ls -lh betinna_${TIMESTAMP}.dump
# → confirma tamanho razoável (10MB+)
```

---

## Passo 3 — Inspecionar backup (opcional, mas recomendado)

```bash
# Listar contents do dump sem restaurar
pg_restore --list ./betinna_${TIMESTAMP}.dump | head -50
```

Confirma:
- Tabelas esperadas presentes (`Cliente`, `Pedido`, `Comissao`, `Empresa`, etc.)
- Versão do Postgres compatível (16+ esperado)
- Tamanho razoável

---

## Passo 4 — Backup do estado ATUAL antes de sobrescrever

⚠️ **NÃO PULE.** Mesmo o estado quebrado pode ter dados recentes não no último backup.

```bash
# Cria um "snapshot pré-restore" em caso de erro humano
BEFORE_TS=$(date -u +%Y%m%d_%H%M%S)
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --file="./pre_restore_${BEFORE_TS}.dump"

ls -lh pre_restore_${BEFORE_TS}.dump
```

Guarde esse arquivo no S3 também:
```bash
aws s3 cp "./pre_restore_${BEFORE_TS}.dump" \
  "s3://$S3_BUCKET/emergency/pre_restore_${BEFORE_TS}.dump" \
  --endpoint-url "$S3_ENDPOINT"
```

---

## Passo 5 — Colocar app em manutenção

Antes do restore real, parar os serviços que escrevem no DB:

```bash
# Pausar API service no Railway dashboard
# Dashboard → api → Settings → Suspend Service

# OU via CLI:
railway service api --action suspend
```

Mostre página de manutenção no frontend (opcional):
- Trocar `VITE_API_URL` para uma URL fake
- OU usar Cloudflare Page Rules / Railway redirect pra rota /maintenance

---

## Passo 6 — Executar restore

```bash
# Restore com --clean = drop objects antes de recriar
# --if-exists = não falha se objeto não existe
# --no-owner --no-acl = portabilidade
# -j 4 = 4 workers paralelos (Railway free plan suporta)

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --jobs=4 \
  --dbname="$DATABASE_URL" \
  --verbose \
  ./betinna_${TIMESTAMP}.dump 2>&1 | tee restore.log
```

Aguarde até retornar "restore complete". Pode levar 10-30min.

---

## Passo 7 — Verificar contagens críticas

```bash
psql "$DATABASE_URL" <<EOF
SELECT 'Empresas' AS tabela, COUNT(*) FROM "Empresa"
UNION ALL SELECT 'Usuarios', COUNT(*) FROM "Usuario"
UNION ALL SELECT 'Clientes', COUNT(*) FROM "Cliente"
UNION ALL SELECT 'Pedidos', COUNT(*) FROM "Pedido"
UNION ALL SELECT 'Comissoes', COUNT(*) FROM "Comissao"
UNION ALL SELECT 'Permissoes', COUNT(*) FROM "Permissao";
EOF
```

Confirma:
- Contagens "razoáveis" comparadas ao snapshot pré-incident
- Nenhuma tabela vazia inesperada
- ADMIN inicial existe: `SELECT * FROM "Usuario" WHERE role = 'ADMIN' LIMIT 1`

---

## Passo 8 — Re-aplicar migrations posteriores (se necessário)

Se o backup é mais antigo que o schema atual:

```bash
cd backend
DATABASE_URL=... npx prisma migrate deploy
```

Isso aplica migrations entre a versão do backup e a versão atual do código.

⚠️ **Se houver migrations destrutivas no meio**, precisará de manual review.

---

## Passo 9 — Redeploy app

```bash
# Volta API
railway service api --action resume

# Worker e Frontend reiniciam sozinhos (depend on api healthy via service deps)
# Mas se necessário:
railway service worker --action restart
railway service frontend --action restart
```

---

## Passo 10 — Smoke tests pós-restore

```bash
# Health basic
curl -i https://betinna-api.up.railway.app/api/v1/health

# Login admin
curl -X POST "https://[SUPABASE_REF].supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@betinna.ai","password":"..."}'

# Verifica /auth/me com token retornado
TOKEN=...
curl -H "Authorization: Bearer $TOKEN" \
  https://betinna-api.up.railway.app/api/v1/auth/me
```

Confirma:
- ✅ Health 200
- ✅ Login admin funciona
- ✅ `/auth/me` retorna user com role ADMIN

E2E completo recomendado:
```bash
cd frontend
E2E_BASE_URL=https://betinna.up.railway.app \
E2E_API_URL=https://betinna-api.up.railway.app \
... \
npx playwright test
```

---

## Passo 11 — Comunicar resolução

- Slack `#betinna-alerts`: "Restore concluído. Serviço normalizado às HH:MM. Dados a partir de [TIMESTAMP backup] estão de volta. Dados perdidos: [diferença entre backup e momento do incident]."
- Email DIRETOR: mesmo conteúdo + link pro postmortem

---

## Passo 12 — Postmortem

Em até 48h, documentar em `docs/incidents/YYYY-MM-DD-titulo.md`:

- Timeline do incident (UTC)
- Causa raiz
- Impacto (clientes afetados, dados perdidos, downtime)
- O que funcionou bem na resposta
- O que não funcionou
- Action items pra evitar próxima vez (com responsável + prazo)

---

## ⚠️ Limitações conhecidas

1. **Dados em fila BullMQ não são parte do backup.** Postgres dump não inclui
   Redis. Jobs pendentes em campanha-envio, fluxos, etc. são perdidos.
   - Mitigação: rerodar campanhas afetadas manualmente pelo admin
2. **WhatsApp Baileys auth state está dentro do backup** (IntegracaoConexao).
   Restaurar volta as sessões com chaves antigas — Baileys pode precisar de
   re-pareamento se Meta invalidou os tokens.
3. **Pré-images dos pedidos não são versionadas.** Se um pedido foi corrompido
   *antes* do último backup, restore pode não recuperar a versão "correta".

---

## Testes periódicos

⚠️ **Restore não testado = restore que não funciona.**

Política recomendada:
- **Quinzenal** (1x cada 15 dias): admin DevOps roda restore-runbook contra
  ambiente STAGING (não prod). Confirma que o último backup do dia consegue
  ser restaurado limpo.
- **Trimestral**: roda restore parcial (uma tabela específica) pra simular
  cenário de "deletei a tabela errada".
- Documenta resultados em `docs/restore-drills/YYYY-MM-DD.md`.
