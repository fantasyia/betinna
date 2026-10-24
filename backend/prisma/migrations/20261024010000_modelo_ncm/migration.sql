-- NCM do produto (24/10): 8 dígitos sem pontuação; variação e kit herdam.
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "ncm" VARCHAR(8);
