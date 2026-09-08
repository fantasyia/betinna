-- Pedido de venda gerado NO ERP a partir do orçamento aprovado.
--
-- O Tiny não é idempotente em `POST /orcamentos/{id}/venda`: chamar duas vezes
-- cria DOIS pedidos pro mesmo negócio, e o segundo só aparece na hora de
-- faturar. Guardar o id aqui é a trava — não é enfeite de auditoria.
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "pedidoErpId" TEXT;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "pedidoErpEm" TIMESTAMP(3);
