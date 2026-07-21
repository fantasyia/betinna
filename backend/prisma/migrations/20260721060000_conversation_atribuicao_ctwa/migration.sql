-- Camada de CONVERSA da atribuição (Click-to-WhatsApp).
-- O lead do CTWA não passa pelo site: não tem querystring nem cookie. O Meta manda
-- o referral do anúncio junto da PRIMEIRA mensagem — e só nela. Guardamos na
-- conversa (1ª-vez-vence) pra o Lead HERDAR quando nascer na triagem.
--
-- Colunas NULLABLE, sem backfill: conversas antigas não têm esse dado.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "leadId"      TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;

-- leadId: ligação EXPLÍCITA conversa↔lead (o match por telefone é frágil —
-- formatação, número que muda, contato com mais de um número).
CREATE INDEX IF NOT EXISTS "Conversation_leadId_idx" ON "Conversation" ("leadId");

-- utmCampaign como COLUNA indexada (não só no JSON): `totalConversas` por campanha
-- em filtro de JSON não-indexado degradaria na escala. Composto e multi-tenant,
-- igual ao índice do Lead.
CREATE INDEX IF NOT EXISTS "Conversation_empresaId_utmCampaign_idx"
  ON "Conversation" ("empresaId", "utmCampaign");
