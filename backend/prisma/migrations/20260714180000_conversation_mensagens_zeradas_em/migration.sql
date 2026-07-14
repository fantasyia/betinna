-- Tombstone do "Zerar conversa": marca quando as mensagens foram apagadas.
-- A ingestão de mensagens ignora reimportações de histórico (history sync do
-- WhatsApp) anteriores a esta data, evitando que o conteúdo zerado ressuscite.
ALTER TABLE "Conversation" ADD COLUMN "mensagensZeradasEm" TIMESTAMP(3);
