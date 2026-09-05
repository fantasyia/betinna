-- Só PIX e CARTÃO DE CRÉDITO. Boleto fica no enum pelo histórico.
ALTER TYPE "PagamentoForma" ADD VALUE IF NOT EXISTS 'CARTAO_CREDITO';
ALTER TABLE "Pedido" ALTER COLUMN "formaPagamento" SET DEFAULT 'PIX';
ALTER TABLE "Proposta" ALTER COLUMN "formaPagamento" SET DEFAULT 'PIX';
