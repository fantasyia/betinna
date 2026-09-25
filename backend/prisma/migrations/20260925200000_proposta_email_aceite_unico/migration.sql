-- O e-mail da proposta sai UMA vez por link de aceite (Léo, 25/09).
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "aceiteEmailEnviadoEm" TIMESTAMP(3);
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "aceiteEmailEnviadoPara" TEXT;
