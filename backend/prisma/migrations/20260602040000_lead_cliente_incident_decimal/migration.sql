-- #17 (Fase 5) — campos de dinheiro de baixo risco Float→Decimal pra precisão de centavos.
-- Lead.valorEstimado, Cliente.limiteCredito, MarketplaceIncident.valor/valorReembolso → NUMERIC(14,2).
ALTER TABLE "Lead"
  ALTER COLUMN "valorEstimado" TYPE DECIMAL(14,2) USING "valorEstimado"::numeric(14,2);

ALTER TABLE "Cliente"
  ALTER COLUMN "limiteCredito" TYPE DECIMAL(14,2) USING "limiteCredito"::numeric(14,2);

ALTER TABLE "MarketplaceIncident"
  ALTER COLUMN "valor" TYPE DECIMAL(14,2) USING "valor"::numeric(14,2),
  ALTER COLUMN "valorReembolso" TYPE DECIMAL(14,2) USING "valorReembolso"::numeric(14,2);
