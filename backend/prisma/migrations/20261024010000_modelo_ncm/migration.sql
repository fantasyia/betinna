-- NCM do produto (24/10): 8 dígitos sem pontuação; variação e kit herdam.
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "ncm" VARCHAR(8);

-- Resto do fiscal (JSON, sem padrão) e "sem GTIN" na variação (24/10).
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "fiscal" JSONB;
ALTER TABLE "CatalogoVariacao" ADD COLUMN IF NOT EXISTS "semGtin" BOOLEAN NOT NULL DEFAULT false;
