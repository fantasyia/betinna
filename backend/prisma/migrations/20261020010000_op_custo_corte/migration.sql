-- Custo de corte da OP (Léo, 20/10): peças cortadas × custo de corte por peça
-- da empresa (config.acabamento.custoCortePorPeca). Só ADD COLUMN.
ALTER TABLE "OrdemProducao" ADD COLUMN IF NOT EXISTS "custoCorte" DECIMAL(14,2) NOT NULL DEFAULT 0;
