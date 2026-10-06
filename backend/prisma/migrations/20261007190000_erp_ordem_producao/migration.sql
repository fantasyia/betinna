-- ERP próprio · Fase 2 · entrega 4 — ordem de produção (corte interno, envio
-- pra facção, recebimento em várias entregas, fechamento com custo real) da
-- Ribelt Distribuidora Têxtil. Só CRIA: o container antigo não conhece nada disto.

-- CreateEnum
CREATE TYPE "OrdemProducaoStatus" AS ENUM ('RASCUNHO', 'CORTADA', 'NA_FACCAO', 'RECEBENDO', 'FECHADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "OrdemProducao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "faccaoId" TEXT,
    "status" "OrdemProducaoStatus" NOT NULL DEFAULT 'RASCUNHO',
    "prazo" TIMESTAMP(3),
    "observacoes" TEXT,
    "precoFaccaoPorPeca" DECIMAL(14,2),
    "custoTecido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "custoAviamentos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "custoFaccao" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usuarioId" TEXT,
    "cortadaEm" TIMESTAMP(3),
    "enviadaEm" TIMESTAMP(3),
    "fechadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrdemProducao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdemProducaoItem" (
    "id" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "modeloLinhaId" TEXT NOT NULL,
    "planejada" INTEGER NOT NULL,
    "cortada" INTEGER,
    "enviada" INTEGER,

    CONSTRAINT "OrdemProducaoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdemProducaoConsumo" (
    "id" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "custoUnitario" DECIMAL(14,4) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrdemProducaoConsumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdemProducaoEntrega" (
    "id" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "defeito" INTEGER NOT NULL DEFAULT 0,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrdemProducaoEntrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdemProducaoCusto" (
    "id" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "modeloLinhaId" TEXT NOT NULL,
    "pecas" INTEGER NOT NULL,
    "custoTotal" DECIMAL(14,2) NOT NULL,
    "custoPorPeca" DECIMAL(14,4) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrdemProducaoCusto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrdemProducao_empresaId_numero_key" ON "OrdemProducao"("empresaId", "numero");
CREATE INDEX "OrdemProducao_empresaId_status_idx" ON "OrdemProducao"("empresaId", "status");
CREATE INDEX "OrdemProducao_faccaoId_status_idx" ON "OrdemProducao"("faccaoId", "status");
CREATE UNIQUE INDEX "OrdemProducaoItem_opId_produtoId_key" ON "OrdemProducaoItem"("opId", "produtoId");
CREATE INDEX "OrdemProducaoConsumo_opId_idx" ON "OrdemProducaoConsumo"("opId");
CREATE INDEX "OrdemProducaoEntrega_opId_idx" ON "OrdemProducaoEntrega"("opId");
CREATE UNIQUE INDEX "OrdemProducaoCusto_opId_modeloLinhaId_key" ON "OrdemProducaoCusto"("opId", "modeloLinhaId");
CREATE INDEX "OrdemProducaoCusto_modeloLinhaId_idx" ON "OrdemProducaoCusto"("modeloLinhaId");

-- AddForeignKey
ALTER TABLE "OrdemProducao" ADD CONSTRAINT "OrdemProducao_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "CatalogoModelo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdemProducao" ADD CONSTRAINT "OrdemProducao_faccaoId_fkey" FOREIGN KEY ("faccaoId") REFERENCES "Faccao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoItem" ADD CONSTRAINT "OrdemProducaoItem_opId_fkey" FOREIGN KEY ("opId") REFERENCES "OrdemProducao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoItem" ADD CONSTRAINT "OrdemProducaoItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoConsumo" ADD CONSTRAINT "OrdemProducaoConsumo_opId_fkey" FOREIGN KEY ("opId") REFERENCES "OrdemProducao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoConsumo" ADD CONSTRAINT "OrdemProducaoConsumo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoEntrega" ADD CONSTRAINT "OrdemProducaoEntrega_opId_fkey" FOREIGN KEY ("opId") REFERENCES "OrdemProducao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoEntrega" ADD CONSTRAINT "OrdemProducaoEntrega_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoCusto" ADD CONSTRAINT "OrdemProducaoCusto_opId_fkey" FOREIGN KEY ("opId") REFERENCES "OrdemProducao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrdemProducaoCusto" ADD CONSTRAINT "OrdemProducaoCusto_modeloLinhaId_fkey" FOREIGN KEY ("modeloLinhaId") REFERENCES "CatalogoModeloLinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
