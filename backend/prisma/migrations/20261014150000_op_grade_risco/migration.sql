-- OP pela grade do risco (Léo, 14/10): a grade (2M 2G 1GG) e as grades por cor.
-- Só referência — as quantidades seguem nos itens da OP.
ALTER TABLE "OrdemProducao" ADD COLUMN IF NOT EXISTS "gradeRisco" JSONB;
