-- Frete da vitrine (Checkout, itens 4 e 5): peso por tamanho e a entrega do pedido.
-- Só ADICIONA colunas anuláveis: código antigo segue funcionando.
ALTER TABLE "CatalogoModeloTamanho" ADD COLUMN IF NOT EXISTS "pesoGramas" INTEGER;
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "entrega" JSONB;
