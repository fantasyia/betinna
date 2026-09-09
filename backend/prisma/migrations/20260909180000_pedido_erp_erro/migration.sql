-- Motivo da falha de envio ao ERP, no próprio pedido.
--
-- O push do pedido do site engole a exceção de propósito (o cliente pagou; o
-- pedido tem que existir mesmo com o ERP fora). O problema era o silêncio: o
-- único registro ficava num log de container que rotaciona em horas. Dois
-- pedidos de teste em 09/09 ficaram RASCUNHO sem número de ERP e não foi
-- possível dizer por quê.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "erpErro" TEXT;
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "erpErroEm" TIMESTAMP(3);
