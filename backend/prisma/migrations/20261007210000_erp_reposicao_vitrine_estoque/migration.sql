-- ERP próprio · Fase 2 · entrega 5 — estoque mínimo por variação (reposição)
-- e "vitrine respeita estoque". Só ADD COLUMN: o container antigo ignora.
ALTER TABLE "CatalogoVariacao" ADD COLUMN IF NOT EXISTS "estoqueMinimo" INTEGER;
ALTER TABLE "Vitrine" ADD COLUMN IF NOT EXISTS "respeitaEstoque" BOOLEAN NOT NULL DEFAULT false;
