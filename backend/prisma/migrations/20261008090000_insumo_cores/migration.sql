-- Insumos com cores (Léo, 07/10): cada matéria-prima com várias cores da lista
-- da empresa; saldo, custo médio e movimento POR COR. Só ADICIONA tabela,
-- colunas, FKs e índices — nada destrutivo. A coluna texto "Insumo"."cor" fica.
CREATE TABLE IF NOT EXISTS "InsumoCor" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "insumoId" TEXT NOT NULL,
  "corId" TEXT NOT NULL,
  "custoMedio" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsumoCor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InsumoCor_insumoId_corId_key" ON "InsumoCor"("insumoId", "corId");
CREATE INDEX IF NOT EXISTS "InsumoCor_empresaId_idx" ON "InsumoCor"("empresaId");

DO $$ BEGIN
  ALTER TABLE "InsumoCor" ADD CONSTRAINT "InsumoCor_insumoId_fkey" FOREIGN KEY ("insumoId")
    REFERENCES "Insumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "InsumoCor" ADD CONSTRAINT "InsumoCor_corId_fkey" FOREIGN KEY ("corId")
    REFERENCES "CatalogoCor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "InsumoMovimento" ADD COLUMN IF NOT EXISTS "insumoCorId" TEXT;
CREATE INDEX IF NOT EXISTS "InsumoMovimento_insumoCorId_idx" ON "InsumoMovimento"("insumoCorId");
DO $$ BEGIN
  ALTER TABLE "InsumoMovimento" ADD CONSTRAINT "InsumoMovimento_insumoCorId_fkey" FOREIGN KEY ("insumoCorId")
    REFERENCES "InsumoCor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "OrdemProducaoConsumo" ADD COLUMN IF NOT EXISTS "insumoCorId" TEXT;
DO $$ BEGIN
  ALTER TABLE "OrdemProducaoConsumo" ADD CONSTRAINT "OrdemProducaoConsumo_insumoCorId_fkey" FOREIGN KEY ("insumoCorId")
    REFERENCES "InsumoCor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "FichaTecnicaItem" ADD COLUMN IF NOT EXISTS "corFixaId" TEXT;
DO $$ BEGIN
  ALTER TABLE "FichaTecnicaItem" ADD CONSTRAINT "FichaTecnicaItem_corFixaId_fkey" FOREIGN KEY ("corFixaId")
    REFERENCES "CatalogoCor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Dados: insumo que hoje tem as cores no TEXTO ("Preto;Bege;Cinza-Claro") vira
-- insumo com cores — só as que batem com a lista da empresa, e só se ainda não
-- tiver movimento (saldo sem cor não teria pra onde ir).
INSERT INTO "InsumoCor" ("id", "empresaId", "insumoId", "corId")
SELECT 'ic' || substr(md5(i."id" || c."id"), 1, 23), i."empresaId", i."id", c."id"
FROM "Insumo" i
CROSS JOIN LATERAL unnest(string_to_array(i."cor", ';')) AS parte(nome)
JOIN "CatalogoCor" c
  ON c."empresaId" = i."empresaId" AND lower(trim(c."nome")) = lower(trim(parte.nome))
WHERE i."cor" LIKE '%;%'
  AND NOT EXISTS (SELECT 1 FROM "InsumoMovimento" m WHERE m."insumoId" = i."id")
ON CONFLICT ("insumoId", "corId") DO NOTHING;

UPDATE "Insumo" i SET "cor" = NULL
WHERE i."cor" LIKE '%;%'
  AND EXISTS (SELECT 1 FROM "InsumoCor" ic WHERE ic."insumoId" = i."id");
