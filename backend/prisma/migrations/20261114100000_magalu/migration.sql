-- Magalu (14/11): pedidos (MarketplaceOrder) e SAC (incidente) do ID Magalu.
ALTER TYPE "MarketplacePlatform" ADD VALUE IF NOT EXISTS 'MAGALU';
ALTER TYPE "MessageChannel" ADD VALUE IF NOT EXISTS 'MARKETPLACE_MAGALU';
