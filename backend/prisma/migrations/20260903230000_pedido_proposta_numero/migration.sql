-- De qual proposta o pedido nasceu. O pedido gerado pelo ERP a partir de um
-- orçamento só herda a observação; o app grava o marcador [PROP-xxxx] nela e
-- guarda aqui o número, pra não depender de reprocessar texto.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "propostaNumero" TEXT;
CREATE INDEX IF NOT EXISTS "Pedido_empresaId_propostaNumero_idx" ON "Pedido"("empresaId", "propostaNumero");
