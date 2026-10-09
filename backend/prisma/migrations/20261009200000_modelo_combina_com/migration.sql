-- Upsell da vitrine: modelos que combinam (conjunto). Só ADICIONA coluna com default.
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "combinaCom" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
