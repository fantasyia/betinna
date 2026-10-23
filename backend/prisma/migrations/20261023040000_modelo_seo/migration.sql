-- Página do produto (23/10): endereços antigos (redirect 301 quando o nome muda),
-- título pro Google/IAs e palavras SEO. Só ADD.
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "slugsAntigos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "tituloSeo" VARCHAR(120);
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "palavrasSeo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
