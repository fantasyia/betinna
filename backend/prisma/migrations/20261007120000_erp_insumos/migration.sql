-- ERP próprio · Fase 2 · entrega 2 — matéria-prima (tecido e aviamento) da
-- Ribelt Distribuidora Têxtil. Só CRIA: o container antigo não conhece nada
-- disto. A flag (`config.erpInterno.ativo`) já foi ligada na entrega 1.

-- CreateEnum
CREATE TYPE "InsumoTipo" AS ENUM ('TECIDO', 'AVIAMENTO');

-- CreateEnum
CREATE TYPE "InsumoUnidade" AS ENUM ('KG', 'METRO', 'UNIDADE', 'PAR');

-- CreateEnum
CREATE TYPE "InsumoMovTipo" AS ENUM ('ENTRADA_COMPRA', 'CONSUMO_CORTE', 'ENVIO_FACCAO', 'SOBRA_RETORNO', 'PERDA', 'AJUSTE');

-- CreateTable
CREATE TABLE "Insumo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "InsumoTipo" NOT NULL,
    "unidade" "InsumoUnidade" NOT NULL,
    "cor" TEXT,
    "fornecedor" TEXT,
    "custoMedio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "estoqueMinimo" DECIMAL(14,3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsumoMovimento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "tipo" "InsumoMovTipo" NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "custoUnitario" DECIMAL(14,4),
    "motivo" TEXT,
    "documento" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsumoMovimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Insumo_empresaId_ativo_idx" ON "Insumo"("empresaId", "ativo");
CREATE INDEX "InsumoMovimento_empresaId_insumoId_idx" ON "InsumoMovimento"("empresaId", "insumoId");
CREATE INDEX "InsumoMovimento_empresaId_criadoEm_idx" ON "InsumoMovimento"("empresaId", "criadoEm");

-- AddForeignKey
ALTER TABLE "InsumoMovimento" ADD CONSTRAINT "InsumoMovimento_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
