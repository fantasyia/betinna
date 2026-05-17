-- CreateEnum
CREATE TYPE "MovimentoFidelidadeTipo" AS ENUM ('GANHO_PEDIDO', 'ESTORNO_PEDIDO', 'RESGATE', 'EXPIRACAO', 'AJUSTE_MANUAL');

-- CreateEnum
CREATE TYPE "RecompensaTipo" AS ENUM ('DESCONTO_PERCENTUAL', 'DESCONTO_VALOR', 'BRINDE');

-- CreateTable
CREATE TABLE "ProgramaFidelidade" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT 'Programa de Fidelidade',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "pontosPorReal" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "ttlMeses" INTEGER NOT NULL DEFAULT 12,
    "valorMinimoPedido" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramaFidelidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecompensaFidelidade" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "custoPontos" INTEGER NOT NULL,
    "tipo" "RecompensaTipo" NOT NULL,
    "valor" DECIMAL(10,2),
    "estoque" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecompensaFidelidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaldoFidelidade" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "pontos" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaldoFidelidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoFidelidade" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" "MovimentoFidelidadeTipo" NOT NULL,
    "pontos" INTEGER NOT NULL,
    "pedidoId" TEXT,
    "recompensaId" TEXT,
    "motivo" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoFidelidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramaFidelidade_empresaId_key" ON "ProgramaFidelidade"("empresaId");

-- CreateIndex
CREATE INDEX "RecompensaFidelidade_empresaId_ativo_idx" ON "RecompensaFidelidade"("empresaId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "SaldoFidelidade_clienteId_key" ON "SaldoFidelidade"("clienteId");

-- CreateIndex
CREATE INDEX "SaldoFidelidade_empresaId_idx" ON "SaldoFidelidade"("empresaId");

-- CreateIndex
CREATE INDEX "MovimentoFidelidade_empresaId_clienteId_criadoEm_idx" ON "MovimentoFidelidade"("empresaId", "clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "MovimentoFidelidade_empresaId_tipo_idx" ON "MovimentoFidelidade"("empresaId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "MovimentoFidelidade_pedidoId_tipo_key" ON "MovimentoFidelidade"("pedidoId", "tipo");

-- AddForeignKey
ALTER TABLE "ProgramaFidelidade" ADD CONSTRAINT "ProgramaFidelidade_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecompensaFidelidade" ADD CONSTRAINT "RecompensaFidelidade_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoFidelidade" ADD CONSTRAINT "SaldoFidelidade_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoFidelidade" ADD CONSTRAINT "SaldoFidelidade_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoFidelidade" ADD CONSTRAINT "MovimentoFidelidade_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoFidelidade" ADD CONSTRAINT "MovimentoFidelidade_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoFidelidade" ADD CONSTRAINT "MovimentoFidelidade_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoFidelidade" ADD CONSTRAINT "MovimentoFidelidade_recompensaId_fkey" FOREIGN KEY ("recompensaId") REFERENCES "RecompensaFidelidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
