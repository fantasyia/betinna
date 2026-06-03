-- Orquestração Fase C — fecha 100% do spec. Tudo aditivo:
-- SLA em horas, allow-list de tags por funil, campos de lead (última msg/próximo
-- SLA), teto por prompt, +2 gatilhos (canal/webhook) e +3 tabelas (versão de
-- prompt, variáveis customizadas, webhook de entrada).

-- AlterEnum: gatilhos de canal + webhook de entrada
ALTER TYPE "FluxoTriggerTipo" ADD VALUE 'MENSAGEM_CANAL';
ALTER TYPE "FluxoTriggerTipo" ADD VALUE 'WEBHOOK_RECEBIDO';

-- AlterTable: SLA em horas
ALTER TABLE "FunilEtapa" ADD COLUMN "slaHoras" INTEGER;

-- AlterTable: allow-list de tags por funil
ALTER TABLE "Funil" ADD COLUMN "tagsPermitidas" JSONB;

-- AlterTable: campos de lead (spec §4)
ALTER TABLE "Lead"
  ADD COLUMN "ultimaMensagemEm" TIMESTAMP(3),
  ADD COLUMN "proximoSlaEm" TIMESTAMP(3);

-- AlterTable: teto de tokens por prompt
ALTER TABLE "BotPrompt"
  ADD COLUMN "tetoTokensDia" INTEGER,
  ADD COLUMN "tetoTokensMes" INTEGER;

-- CreateTable: histórico de versões de prompt
CREATE TABLE "BotPromptVersao" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "modelo" TEXT,
    "temperatura" DOUBLE PRECISION,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotPromptVersao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BotPromptVersao_promptId_versao_key" ON "BotPromptVersao"("promptId", "versao");
CREATE INDEX "BotPromptVersao_promptId_idx" ON "BotPromptVersao"("promptId");

-- CreateTable: variáveis customizadas (admin)
CREATE TABLE "VariavelCustomizada" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "descricao" TEXT,
    "valorPadrao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VariavelCustomizada_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VariavelCustomizada_empresaId_chave_key" ON "VariavelCustomizada"("empresaId", "chave");
CREATE INDEX "VariavelCustomizada_empresaId_idx" ON "VariavelCustomizada"("empresaId");

-- CreateTable: webhook de entrada por empresa
CREATE TABLE "WebhookEntrada" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEntrada_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookEntrada_token_key" ON "WebhookEntrada"("token");
CREATE INDEX "WebhookEntrada_empresaId_idx" ON "WebhookEntrada"("empresaId");

-- AddForeignKey
ALTER TABLE "BotPromptVersao" ADD CONSTRAINT "BotPromptVersao_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "BotPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VariavelCustomizada" ADD CONSTRAINT "VariavelCustomizada_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookEntrada" ADD CONSTRAINT "WebhookEntrada_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
