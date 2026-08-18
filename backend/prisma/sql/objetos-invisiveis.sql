-- Objetos que o Prisma NÃO conhece (não existem no schema.prisma) e que
-- `prisma db push` REMOVE ao reconciliar o banco com o schema.
--
-- O deploy só cai no `db push --accept-data-loss` como fallback, mas quando cai
-- ele apagava estes índices em silêncio, com exit 0 e log de sucesso. O mais
-- grave: os dois UNIQUE parciais da Conversation são a ÚNICA proteção contra a
-- corrida do upsert da Inbox (o Prisma não suporta unique parcial declarativo, e
-- unique comum não funciona porque Postgres trata NULLs como distintos). Sem
-- eles, duas mensagens simultâneas do mesmo contato criam duas conversas.
--
-- Todos são idempotentes (IF NOT EXISTS) — o deploy-migrations.js reaplica este
-- arquivo depois de todo `db push`. Ao criar um novo índice só-SQL numa
-- migration, ADICIONE ELE AQUI TAMBÉM.

-- ── Race protection do upsert da Inbox (20260517010000) ──────────────
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_canal_peer_empresa_unique_null"
  ON "Conversation"("empresaId", "canal", "peerId")
  WHERE "proprietarioId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_canal_peer_empresa_unique_owned"
  ON "Conversation"("empresaId", "canal", "peerId", "proprietarioId")
  WHERE "proprietarioId" IS NOT NULL;

-- ── Match por sufixo de telefone, D18 (20260613130000 / 20260613150000) ──
CREATE INDEX IF NOT EXISTS "Cliente_empresaId_telefoneSufixo_idx"
  ON "Cliente" ("empresaId", (RIGHT(REGEXP_REPLACE("telefone", '[^0-9]', '', 'g'), 8)));

CREATE INDEX IF NOT EXISTS "Lead_empresaId_telefoneSufixo_idx"
  ON "Lead" ("empresaId", (RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8)));

-- ── E-mail único por empresa, case-insensitive (20260716090000) ──────
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_empresa_email_lower_unique"
  ON "Lead" ("empresaId", LOWER("contatoEmail"))
  WHERE "contatoEmail" IS NOT NULL AND "contatoEmail" <> '';

-- ── Dedup do inbound da Inbox (20260808200000) ───────────────────────
CREATE INDEX IF NOT EXISTS "Message_externalId_idx"
  ON "Message" ("externalId")
  WHERE "externalId" IS NOT NULL;

-- ── Busca semântica / RAG (20260623150000) ───────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS "Produto_embedding_hnsw_idx"
  ON "Produto" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw_idx"
  ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);

-- ── Alerta de conversa esquecida, card 🔔 (20260812010000) ───────────
CREATE INDEX IF NOT EXISTS "Conversation_alertaEsquecidaEm_idx"
  ON "Conversation" ("empresaId", "alertaEsquecidaEm")
  WHERE "alertaEsquecidaEm" IS NOT NULL;
