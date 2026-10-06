-- ERP próprio · regras de encaixe por produto (ficha técnica) da Ribelt
-- Distribuidora. Só ADD COLUMN nullable: o container antigo ignora.
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "regrasEncaixe" JSONB;
