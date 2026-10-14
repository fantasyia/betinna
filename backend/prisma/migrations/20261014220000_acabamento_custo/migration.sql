-- Acabamento (Léo, 14/10): a Isabela cobra por tarefa (cordão, embalar, ilhós).
-- Ficha: quais serviços a grade leva (ids da lista em Empresa.config.acabamento).
-- OP: o custo do acabamento, calculado no fechamento. Só ADD.
ALTER TABLE "FichaTecnica" ADD COLUMN IF NOT EXISTS "acabamento" JSONB;
ALTER TABLE "OrdemProducao" ADD COLUMN IF NOT EXISTS "custoAcabamento" DECIMAL(14,2) NOT NULL DEFAULT 0;
