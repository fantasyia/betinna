-- Frete do pedido em coluna própria. Ele já entrava em `total` (site e ERP),
-- e a comissão era calculada em cima — frete não é venda.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "frete" DECIMAL(14,2) NOT NULL DEFAULT 0;
