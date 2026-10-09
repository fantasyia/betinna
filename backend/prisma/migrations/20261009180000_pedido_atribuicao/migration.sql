-- Pixel do Meta + API de Conversões na vitrine: atribuição do pedido.
-- Só ADICIONA coluna anulável: código antigo segue funcionando.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "atribuicao" JSONB;
