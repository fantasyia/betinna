-- UM PDF (levantamento + contrato) congelado no link: vai pra ClickSign como documento único (Léo, 25/09).
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "documentoPdfPath" TEXT;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "documentoPdfSha256" TEXT;
