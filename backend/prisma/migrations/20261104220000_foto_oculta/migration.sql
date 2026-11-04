-- Esconder foto da vitrine sem apagar.
ALTER TABLE "CatalogoFoto" ADD COLUMN IF NOT EXISTS "oculta" BOOLEAN NOT NULL DEFAULT false;
