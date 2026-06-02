-- #17 (Fase 3) — Proposta/PropostaItem: dinheiro Float→Decimal pra precisão de centavos.
-- subtotal/valor/comissaoEstimada (Proposta) e precoUnitario/total (PropostaItem) viram NUMERIC(14,2).
-- descontoGeral/desconto (%) seguem double.
ALTER TABLE "Proposta"
  ALTER COLUMN "subtotal" TYPE DECIMAL(14,2) USING "subtotal"::numeric(14,2),
  ALTER COLUMN "valor" TYPE DECIMAL(14,2) USING "valor"::numeric(14,2),
  ALTER COLUMN "comissaoEstimada" TYPE DECIMAL(14,2) USING "comissaoEstimada"::numeric(14,2);
ALTER TABLE "PropostaItem"
  ALTER COLUMN "precoUnitario" TYPE DECIMAL(14,2) USING "precoUnitario"::numeric(14,2),
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING "total"::numeric(14,2);
