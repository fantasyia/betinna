-- Extrato linha a linha do pedido de marketplace (24/10).
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "extrato" JSONB;
