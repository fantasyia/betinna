-- Contrato congelado no link de aceite: o cliente lê o MESMO arquivo que assina (Léo, 25/09).
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "contratoPreviaPath" TEXT;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "contratoPreviaSha256" TEXT;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "contratoPreviaModeloVersao" INTEGER;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "contratoPreviaEm" TIMESTAMP(3);
