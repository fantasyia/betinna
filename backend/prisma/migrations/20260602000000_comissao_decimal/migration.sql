-- #17 (Fase 1) — Comissao: dinheiro Float→Decimal pra precisão de centavos.
-- totalVendas e totalComissao viram NUMERIC(14,2). percentual (%) segue double.
ALTER TABLE "Comissao"
  ALTER COLUMN "totalVendas" TYPE DECIMAL(14,2) USING "totalVendas"::numeric(14,2),
  ALTER COLUMN "totalComissao" TYPE DECIMAL(14,2) USING "totalComissao"::numeric(14,2);
