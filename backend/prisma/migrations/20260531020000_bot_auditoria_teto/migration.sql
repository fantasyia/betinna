-- Sprint 2.2 — Auditoria das respostas do bot + teto de custo (tokens OpenAI).
-- 100% aditivo: 2 tabelas novas, 1 enum novo e colunas novas em MullerBotPersona.

-- CreateEnum
CREATE TYPE "BotRespostaStatus" AS ENUM ('OK', 'FALLBACK', 'SEM_RESPOSTA');

-- CreateTable
CREATE TABLE "BotResposta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "pergunta" TEXT NOT NULL,
    "resposta" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "tempoMs" INTEGER,
    "modelo" TEXT,
    "status" "BotRespostaStatus" NOT NULL DEFAULT 'OK',
    "marcadaRevisao" BOOLEAN NOT NULL DEFAULT false,
    "motivoRevisao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotResposta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotResposta_empresaId_criadoEm_idx" ON "BotResposta"("empresaId", "criadoEm");
CREATE INDEX "BotResposta_empresaId_marcadaRevisao_idx" ON "BotResposta"("empresaId", "marcadaRevisao");
CREATE INDEX "BotResposta_conversationId_idx" ON "BotResposta"("conversationId");

-- CreateTable
CREATE TABLE "BotUsoTokens" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotUsoTokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotUsoTokens_empresaId_dia_key" ON "BotUsoTokens"("empresaId", "dia");
CREATE INDEX "BotUsoTokens_empresaId_idx" ON "BotUsoTokens"("empresaId");

-- AlterTable (teto de custo na persona)
ALTER TABLE "MullerBotPersona"
  ADD COLUMN IF NOT EXISTS "limiteTokensDiaIn" INTEGER NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS "limiteTokensDiaOut" INTEGER NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS "limiteTokensMesIn" INTEGER NOT NULL DEFAULT 2000000,
  ADD COLUMN IF NOT EXISTS "limiteTokensMesOut" INTEGER NOT NULL DEFAULT 2000000,
  ADD COLUMN IF NOT EXISTS "pausadoPorCustoAte" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ultimoAlertaCustoEm" TIMESTAMP(3);
