-- Vínculo do pedido com o ERP passa a ser o ID, não o número.
--
-- O Tiny REAPROVEITA numeração: em 09/09, PED-0072 e PED-0073 (importados do
-- ERP) já ocupavam os números 44 e 45, e os dois pedidos que o app criou no
-- mesmo dia voltaram com os MESMOS números. A gravação batia no unique
-- (empresaId, numeroErp), estourava, e o pedido ficava RASCUNHO no app com o
-- pedido JÁ CRIADO no ERP — estado em que um reenvio manual duplicaria.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "erpPedidoId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Pedido_empresaId_erpPedidoId_key"
  ON "Pedido" ("empresaId", "erpPedidoId");
