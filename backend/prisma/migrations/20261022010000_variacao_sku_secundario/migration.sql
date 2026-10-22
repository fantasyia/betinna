-- SKU secundário da peça (Léo, 22/10): código do sistema anterior. Só ADD.
ALTER TABLE "CatalogoVariacao" ADD COLUMN IF NOT EXISTS "skuSecundario" TEXT;
