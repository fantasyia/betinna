-- Dedup de mensagem entrante (InboxService.processarMensagemEntrante) consulta
-- Message por `externalId` ANTES de casar a conversa — é o caminho mais quente
-- do inbound (roda em TODA mensagem que entra, do webhook e do poll de
-- fallback). Sem índice, vira seq scan na tabela que mais cresce no banco.
--
-- Índice PARCIAL: mensagem sem externalId (outbound ainda pendente) não entra —
-- mantém o índice pequeno e a query sempre filtra `externalId = <valor>`.
CREATE INDEX IF NOT EXISTS "Message_externalId_idx"
  ON "Message" ("externalId")
  WHERE "externalId" IS NOT NULL;
