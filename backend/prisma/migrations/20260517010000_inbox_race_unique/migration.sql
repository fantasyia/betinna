-- Auditoria 2026-05-17 (M2): race protection no `Conversation` upsert.
--
-- O Prisma não suporta `@@unique` parcial via schema declarativo, e o constraint
-- `[empresaId, canal, peerId, proprietarioId]` direto não funciona porque Postgres
-- considera NULLs distintos — então 2 INSERTs simultâneos com proprietarioId=NULL
-- ambos passam.
--
-- Solução: dois indexes parciais separados, um para cada caso.
-- O service `InboxService.upsertConversation` captura P2002 e refaz lookup.

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_canal_peer_empresa_unique_null"
  ON "Conversation"("empresaId", "canal", "peerId")
  WHERE "proprietarioId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_canal_peer_empresa_unique_owned"
  ON "Conversation"("empresaId", "canal", "peerId", "proprietarioId")
  WHERE "proprietarioId" IS NOT NULL;
