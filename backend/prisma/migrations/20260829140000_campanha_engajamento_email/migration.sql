-- Engajamento de e-mail marketing (webhook do Resend).
--
-- `resendEmailId` é o ELO: sem ele o evento de abertura/clique chega e não há
-- onde pendurar. `lido`/`lidoEm` que já existiam são do recibo do WhatsApp
-- (Baileys) e não servem pra e-mail.
ALTER TABLE "CampanhaDestinatario" ADD COLUMN IF NOT EXISTS "resendEmailId" TEXT;
ALTER TABLE "CampanhaDestinatario" ADD COLUMN IF NOT EXISTS "entregueEm" TIMESTAMP(3);
ALTER TABLE "CampanhaDestinatario" ADD COLUMN IF NOT EXISTS "abertoEm" TIMESTAMP(3);
ALTER TABLE "CampanhaDestinatario" ADD COLUMN IF NOT EXISTS "clicadoEm" TIMESTAMP(3);
ALTER TABLE "CampanhaDestinatario" ADD COLUMN IF NOT EXISTS "bounceEm" TIMESTAMP(3);
ALTER TABLE "CampanhaDestinatario" ADD COLUMN IF NOT EXISTS "aberturas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CampanhaDestinatario" ADD COLUMN IF NOT EXISTS "cliques" INTEGER NOT NULL DEFAULT 0;

-- Unique: um id do Resend pertence a UM destinatário. É o que impede o mesmo
-- evento reprocessado escrever em dois lugares.
CREATE UNIQUE INDEX IF NOT EXISTS "CampanhaDestinatario_resendEmailId_key"
  ON "CampanhaDestinatario"("resendEmailId");
CREATE INDEX IF NOT EXISTS "CampanhaDestinatario_resendEmailId_idx"
  ON "CampanhaDestinatario"("resendEmailId");
