-- Vitrine de atacado: categoria vira LISTA da empresa (06/10/2026).
-- Só mexe em tabelas da vitrine (CatalogoModelo + a nova CatalogoCategoria).
-- Converte a categoria já digitada em texto ANTES de remover a coluna: o
-- cadastro já está em uso e nenhum valor pode se perder.

-- CreateTable
CREATE TABLE "CatalogoCategoria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogoCategoria_empresaId_ordem_idx" ON "CatalogoCategoria"("empresaId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoCategoria_empresaId_nome_key" ON "CatalogoCategoria"("empresaId", "nome");

-- AddForeignKey
ALTER TABLE "CatalogoCategoria" ADD CONSTRAINT "CatalogoCategoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nova coluna
ALTER TABLE "CatalogoModelo" ADD COLUMN "categoriaId" TEXT;

-- Migra o texto livre: uma categoria por (empresa, nome) distinto, já aparada.
INSERT INTO "CatalogoCategoria" ("id", "empresaId", "nome", "atualizadoEm")
SELECT 'cat_' || md5("empresaId" || '|' || btrim("categoria")), "empresaId", btrim("categoria"), CURRENT_TIMESTAMP
FROM "CatalogoModelo"
WHERE "categoria" IS NOT NULL AND btrim("categoria") <> ''
GROUP BY "empresaId", btrim("categoria");

UPDATE "CatalogoModelo" m
SET "categoriaId" = c."id"
FROM "CatalogoCategoria" c
WHERE c."empresaId" = m."empresaId" AND c."nome" = btrim(m."categoria");

-- AddForeignKey
ALTER TABLE "CatalogoModelo" ADD CONSTRAINT "CatalogoModelo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CatalogoCategoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Só agora a coluna de texto sai.
ALTER TABLE "CatalogoModelo" DROP COLUMN "categoria";
