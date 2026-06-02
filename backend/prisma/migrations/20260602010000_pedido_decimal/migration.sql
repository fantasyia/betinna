-- #17 (Fase 2) — Pedido/PedidoItem: dinheiro Float→Decimal pra precisão de centavos.
-- subtotal/total/comissao (Pedido) e precoUnitario/total (PedidoItem) viram NUMERIC(14,2).
-- descontoGeral/desconto (%) seguem double.
ALTER TABLE "Pedido"
  ALTER COLUMN "subtotal" TYPE DECIMAL(14,2) USING "subtotal"::numeric(14,2),
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING "total"::numeric(14,2),
  ALTER COLUMN "comissao" TYPE DECIMAL(14,2) USING "comissao"::numeric(14,2);
ALTER TABLE "PedidoItem"
  ALTER COLUMN "precoUnitario" TYPE DECIMAL(14,2) USING "precoUnitario"::numeric(14,2),
  ALTER COLUMN "total" TYPE DECIMAL(14,2) USING "total"::numeric(14,2);
