-- Pedido nascido de proposta com CONTRATO ASSINADO fica travado até o ERP
-- liberar. Estado próprio (e não RASCUNHO) porque rascunho o rep edita e
-- reenvia — e aqui não há nada pra decidir no app.
ALTER TYPE "PedidoStatus" ADD VALUE IF NOT EXISTS 'AGUARDANDO_LIBERACAO';
