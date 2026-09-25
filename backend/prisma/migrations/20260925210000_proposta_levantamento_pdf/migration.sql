-- PDF do Levantamento técnico de projeto, gerado pelo app e congelado no link (Léo, 25/09).
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "levantamentoPdfPath" TEXT;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "levantamentoPdfSha256" TEXT;
