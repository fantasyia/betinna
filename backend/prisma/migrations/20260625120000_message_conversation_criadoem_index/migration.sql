-- Índice COMPOSTO p/ a query QUENTE de histórico/listagem de mensagens:
--   WHERE "conversationId" = $1 ORDER BY "criadoEm" DESC LIMIT N
-- Roda em TODA mensagem inbound do bot (montarHistorico em muller-whatsapp.service /
-- conversar-ia.service) e em cada abertura de thread no Inbox (listMensagens).
-- Com só "Message_conversationId_idx" (1 coluna), o Postgres filtra por conversa e ORDENA
-- criadoEm em memória; o composto serve o ORDER BY pelo próprio índice (scan reverso p/ DESC).
-- O composto também cobre buscas por conversationId sozinho (prefixo), então o índice avulso
-- "Message_conversationId_idx" fica redundante e é dropado (menos custo de escrita por INSERT).
--
-- NOTA: CREATE INDEX comum (não CONCURRENTLY) porque `prisma migrate deploy` roda a migration
-- DENTRO de uma transação, e CREATE INDEX CONCURRENTLY não pode rodar em transação (erro do
-- Postgres). No volume atual (1 tenant) a tabela Message é pequena → o build é rápido e o lock
-- de escrita é breve. Se a tabela crescer muito, criar o índice manualmente CONCURRENTLY fora
-- do pipeline e marcar a migration como aplicada (migrate resolve).
DROP INDEX "Message_conversationId_idx";
CREATE INDEX "Message_conversationId_criadoEm_idx" ON "Message"("conversationId", "criadoEm");
