-- ERP próprio · Fase 2 · entrega 3 — ficha técnica (consumo médio por grade)
-- e facções, da Ribelt Distribuidora Têxtil. Só CRIA: o container antigo não
-- conhece nada disto.

-- CreateTable
CREATE TABLE "FichaTecnica" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "modeloLinhaId" TEXT NOT NULL,
    "custoFaccaoPrevisto" DECIMAL(14,2),
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FichaTecnica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FichaTecnicaItem" (
    "id" TEXT NOT NULL,
    "fichaId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "consumoPorPeca" DECIMAL(14,4) NOT NULL,
    "observacao" TEXT,

    CONSTRAINT "FichaTecnicaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faccao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "contato" TEXT,
    "telefone" TEXT,
    "especialidade" TEXT,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faccao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaccaoPreco" (
    "id" TEXT NOT NULL,
    "faccaoId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "precoPorPeca" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "FaccaoPreco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FichaTecnica_modeloLinhaId_key" ON "FichaTecnica"("modeloLinhaId");
CREATE INDEX "FichaTecnica_empresaId_idx" ON "FichaTecnica"("empresaId");
CREATE UNIQUE INDEX "FichaTecnicaItem_fichaId_insumoId_key" ON "FichaTecnicaItem"("fichaId", "insumoId");
CREATE INDEX "Faccao_empresaId_ativo_idx" ON "Faccao"("empresaId", "ativo");
CREATE UNIQUE INDEX "FaccaoPreco_faccaoId_modeloId_key" ON "FaccaoPreco"("faccaoId", "modeloId");

-- AddForeignKey
ALTER TABLE "FichaTecnica" ADD CONSTRAINT "FichaTecnica_modeloLinhaId_fkey" FOREIGN KEY ("modeloLinhaId") REFERENCES "CatalogoModeloLinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FichaTecnicaItem" ADD CONSTRAINT "FichaTecnicaItem_fichaId_fkey" FOREIGN KEY ("fichaId") REFERENCES "FichaTecnica"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FichaTecnicaItem" ADD CONSTRAINT "FichaTecnicaItem_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaccaoPreco" ADD CONSTRAINT "FaccaoPreco_faccaoId_fkey" FOREIGN KEY ("faccaoId") REFERENCES "Faccao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaccaoPreco" ADD CONSTRAINT "FaccaoPreco_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "CatalogoModelo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
