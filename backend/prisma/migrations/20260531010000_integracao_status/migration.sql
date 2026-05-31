-- Sprint 2.1 — Semáforo de saúde das integrações por empresa.
-- Alimentado pelos hooks de sucesso/erro; a UI mostra o badge e o backend
-- dispara alerta por e-mail quando uma integração cai. 100% aditivo.

-- CreateEnum
CREATE TYPE "IntegracaoStatusValor" AS ENUM ('ATIVA', 'DEGRADADA', 'CAIDA', 'DESCONECTADA');

-- CreateTable
CREATE TABLE "IntegracaoStatus" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "servico" TEXT NOT NULL,
    "status" "IntegracaoStatusValor" NOT NULL DEFAULT 'ATIVA',
    "ultimoErro" TEXT,
    "ultimoErroEm" TIMESTAMP(3),
    "ultimaVerificacaoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errosSeguidos" INTEGER NOT NULL DEFAULT 0,
    "ultimoAlertaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegracaoStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegracaoStatus_empresaId_servico_key" ON "IntegracaoStatus"("empresaId", "servico");

-- CreateIndex
CREATE INDEX "IntegracaoStatus_empresaId_idx" ON "IntegracaoStatus"("empresaId");
