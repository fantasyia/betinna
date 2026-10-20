-- EAN-13 por peça (Léo, 20/10). Só ADD + índice único por empresa
-- (NULL não conflita: peça sem EAN pode haver quantas forem).
ALTER TABLE "CatalogoVariacao" ADD COLUMN IF NOT EXISTS "ean" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoVariacao_empresaId_ean_key" ON "CatalogoVariacao"("empresaId", "ean");
