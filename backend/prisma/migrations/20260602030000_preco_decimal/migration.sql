-- #17 (Fase 4) — Preços: dinheiro Float→Decimal pra precisão de centavos.
-- Produto.precoTabela/precoFabrica + ClientePrecoEspecial.precoEspecial viram NUMERIC(14,2).
-- descontoBase (%) segue double.
ALTER TABLE "Produto"
  ALTER COLUMN "precoTabela" TYPE DECIMAL(14,2) USING "precoTabela"::numeric(14,2),
  ALTER COLUMN "precoFabrica" TYPE DECIMAL(14,2) USING "precoFabrica"::numeric(14,2);

ALTER TABLE "ClientePrecoEspecial"
  ALTER COLUMN "precoEspecial" TYPE DECIMAL(14,2) USING "precoEspecial"::numeric(14,2);
