-- Conta a pagar de comissão POR PEDIDO (uma por pedido/pessoa, quando a NF sai).
ALTER TABLE "PedidoComissao" ADD COLUMN IF NOT EXISTS "contaPagarErpId" TEXT;
ALTER TABLE "PedidoComissao" ADD COLUMN IF NOT EXISTS "contaPagarValor" DECIMAL(14,2);
