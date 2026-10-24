-- Financeiro dos pedidos de marketplace + vínculo SKU → produto (24/10). Só ADD.
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "itens" JSONB;
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "taxas" DOUBLE PRECISION;
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "frete" DOUBLE PRECISION;
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "liquido" DOUBLE PRECISION;
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "custo" DOUBLE PRECISION;
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "custoCompleto" BOOLEAN;
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "financeiroEm" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "SkuMarketplaceVinculo" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "plataforma" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "variacaoId" TEXT NOT NULL,
  "quantidade" INTEGER NOT NULL DEFAULT 1,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkuMarketplaceVinculo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SkuMarketplaceVinculo_empresaId_plataforma_sku_key" ON "SkuMarketplaceVinculo"("empresaId", "plataforma", "sku");
ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "situacao" TEXT;
CREATE INDEX IF NOT EXISTS "MarketplaceOrder_empresaId_situacao_idx" ON "MarketplaceOrder"("empresaId", "situacao");
