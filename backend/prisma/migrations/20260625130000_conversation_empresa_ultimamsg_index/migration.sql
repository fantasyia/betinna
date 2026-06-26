-- Índice COMPOSTO p/ a query MAIS QUENTE do produto: lista do Inbox (poll de 2s × N operadores).
--   WHERE "empresaId" = $1 [AND "status" ...] ORDER BY "ultimaMsgEm" DESC LIMIT N
-- (inbox.service list/listarContatosWhatsapp/inbox-metricas). Com só "Conversation_ultimaMsgEm_idx"
-- (1 coluna), o filtro por empresaId+status nunca casa com a ordenação → sort em memória a cada tick.
-- O composto (empresaId, ultimaMsgEm) serve o filtro de tenant + o ORDER BY pelo índice (scan
-- reverso p/ DESC). status costuma ser notIn (negação não se beneficia de coluna no meio do índice),
-- por isso ficamos em (empresaId, ultimaMsgEm). Toda query é tenant-scoped → o índice avulso de
-- ultimaMsgEm fica redundante e é dropado (menos custo de escrita).
--
-- CREATE INDEX comum (não CONCURRENTLY): migrate deploy é transacional. Volume atual (1 tenant) →
-- build rápido, lock breve.
DROP INDEX "Conversation_ultimaMsgEm_idx";
CREATE INDEX "Conversation_empresaId_ultimaMsgEm_idx" ON "Conversation"("empresaId", "ultimaMsgEm");
