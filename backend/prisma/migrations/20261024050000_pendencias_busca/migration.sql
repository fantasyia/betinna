-- Aba única de pendências (24/10): campos de busca + estado da resposta da IA.
ALTER TABLE "PendenciaMarketplace" ADD COLUMN IF NOT EXISTS "comprador" VARCHAR(120);
ALTER TABLE "PendenciaMarketplace" ADD COLUMN IF NOT EXISTS "pedido" VARCHAR(60);
ALTER TABLE "PendenciaMarketplace" ADD COLUMN IF NOT EXISTS "anuncio" VARCHAR(80);
ALTER TABLE "PendenciaMarketplace" ADD COLUMN IF NOT EXISTS "estado" VARCHAR(30);
CREATE INDEX IF NOT EXISTS "PendenciaMarketplace_empresaId_criadoEm_idx" ON "PendenciaMarketplace"("empresaId", "criadoEm");
