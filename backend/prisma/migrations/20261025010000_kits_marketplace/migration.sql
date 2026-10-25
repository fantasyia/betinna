-- Kits dos marketplaces no ERP (25/10, card cmvnyodx7): tabelas novas, separadas da vitrine.
CREATE TABLE IF NOT EXISTS "CatalogoKit" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "produto" VARCHAR(120) NOT NULL,
  "modelo" VARCHAR(80) NOT NULL,
  "combinacao" VARCHAR(160) NOT NULL,
  "pecas" INTEGER NOT NULL,
  "aleatorio" BOOLEAN NOT NULL DEFAULT false,
  "modelosBase" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "origem" VARCHAR(30) NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogoKit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoKit_empresaId_produto_modelo_combinacao_key" ON "CatalogoKit"("empresaId", "produto", "modelo", "combinacao");
CREATE INDEX IF NOT EXISTS "CatalogoKit_empresaId_idx" ON "CatalogoKit"("empresaId");

CREATE TABLE IF NOT EXISTS "CatalogoKitItem" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "kitId" TEXT NOT NULL,
  "tamanho" VARCHAR(10) NOT NULL,
  "sku" VARCHAR(60) NOT NULL,
  "skuSecundario" VARCHAR(30),
  "situacaoMagis" VARCHAR(30),
  "composicaoOk" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogoKitItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoKitItem_empresaId_sku_key" ON "CatalogoKitItem"("empresaId", "sku");
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoKitItem_kitId_tamanho_key" ON "CatalogoKitItem"("kitId", "tamanho");
CREATE INDEX IF NOT EXISTS "CatalogoKitItem_empresaId_skuSecundario_idx" ON "CatalogoKitItem"("empresaId", "skuSecundario");
DO $$ BEGIN
  ALTER TABLE "CatalogoKitItem" ADD CONSTRAINT "CatalogoKitItem_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "CatalogoKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CatalogoKitComponente" (
  "id" TEXT NOT NULL,
  "kitItemId" TEXT NOT NULL,
  "variacaoId" TEXT NOT NULL,
  "quantidade" INTEGER NOT NULL,
  CONSTRAINT "CatalogoKitComponente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoKitComponente_kitItemId_variacaoId_key" ON "CatalogoKitComponente"("kitItemId", "variacaoId");
CREATE INDEX IF NOT EXISTS "CatalogoKitComponente_variacaoId_idx" ON "CatalogoKitComponente"("variacaoId");
DO $$ BEGIN
  ALTER TABLE "CatalogoKitComponente" ADD CONSTRAINT "CatalogoKitComponente_kitItemId_fkey" FOREIGN KEY ("kitItemId") REFERENCES "CatalogoKitItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CatalogoKitComponente" ADD CONSTRAINT "CatalogoKitComponente_variacaoId_fkey" FOREIGN KEY ("variacaoId") REFERENCES "CatalogoVariacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
