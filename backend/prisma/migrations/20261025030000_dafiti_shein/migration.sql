-- Dafiti e Shein como plataformas de pedido (25/10, Léo: todos os canais no app).
ALTER TYPE "MarketplacePlatform" ADD VALUE IF NOT EXISTS 'DAFITI';
ALTER TYPE "MarketplacePlatform" ADD VALUE IF NOT EXISTS 'SHEIN';
