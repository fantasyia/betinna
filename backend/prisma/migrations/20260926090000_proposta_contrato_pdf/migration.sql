-- Contrato em PDF, convertido no servidor e congelado no link (Léo, 25/09).
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "contratoPdfPath" TEXT;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "contratoPdfSha256" TEXT;
