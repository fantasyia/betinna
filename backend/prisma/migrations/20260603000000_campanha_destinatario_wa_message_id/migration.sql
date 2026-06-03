-- Recibo de leitura WhatsApp → LIDO.
-- Guarda o id da mensagem Baileys (key.id) no destinatário pra casar o read
-- receipt (messages.update status=READ) e marcar a campanha como LIDA.
ALTER TABLE "CampanhaDestinatario" ADD COLUMN "waMessageId" TEXT;

CREATE INDEX "CampanhaDestinatario_waMessageId_idx" ON "CampanhaDestinatario"("waMessageId");
