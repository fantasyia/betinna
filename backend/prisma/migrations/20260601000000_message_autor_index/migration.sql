-- P1 #11: índice para filtrar mensagens por atendente (autorUsuarioId).
-- Sem ele, filtrar o Inbox/auditoria por usuário varre a tabela Message inteira.
-- Tabela pequena no piloto → CREATE INDEX padrão (rápido, lock desprezível).
-- CreateIndex
CREATE INDEX "Message_autorUsuarioId_idx" ON "Message"("autorUsuarioId");
