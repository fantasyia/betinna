-- Insumo: preço de referência (vale até a 1ª compra) e foto — no insumo e por cor (Léo, 14/10).
ALTER TABLE "Insumo" ADD COLUMN IF NOT EXISTS "precoReferencia" DECIMAL(14,4);
ALTER TABLE "Insumo" ADD COLUMN IF NOT EXISTS "fotoPath" TEXT;
ALTER TABLE "Insumo" ADD COLUMN IF NOT EXISTS "fotoThumbPath" TEXT;
ALTER TABLE "InsumoCor" ADD COLUMN IF NOT EXISTS "precoReferencia" DECIMAL(14,4);
ALTER TABLE "InsumoCor" ADD COLUMN IF NOT EXISTS "fotoPath" TEXT;
ALTER TABLE "InsumoCor" ADD COLUMN IF NOT EXISTS "fotoThumbPath" TEXT;
