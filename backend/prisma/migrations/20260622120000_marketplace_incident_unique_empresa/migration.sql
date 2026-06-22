-- Recria a unicidade do MarketplaceIncident incluindo empresaId.
-- Antes: @@unique([canal, externalId]) — global. Dois tenants com o MESMO (canal, externalId)
-- colidiam: o findUnique do registrarIncidente casava o incidente do OUTRO tenant e o update
-- escrevia por cima dele (corrupção cross-tenant). Adicionar empresaId isola por empresa.
-- Migração segura: o índice antigo era MAIS restritivo, então não há duplicatas a resolver.
DROP INDEX IF EXISTS "MarketplaceIncident_canal_externalId_key";
CREATE UNIQUE INDEX "MarketplaceIncident_empresaId_canal_externalId_key"
  ON "MarketplaceIncident" ("empresaId", "canal", "externalId");
