-- Frete da facção por OP (Léo, 20/10): R$ 150 por corte, rateado nas peças. Só ADD.
ALTER TABLE "OrdemProducao" ADD COLUMN IF NOT EXISTS "custoFrete" DECIMAL(14,2) NOT NULL DEFAULT 0;
