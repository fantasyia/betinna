-- Frete de produção (Léo, 23/10): peças cortadas × R$ 0,15 por peça. Só ADD.
ALTER TABLE "OrdemProducao" ADD COLUMN IF NOT EXISTS "custoFrete" DECIMAL(14,2) NOT NULL DEFAULT 0;
