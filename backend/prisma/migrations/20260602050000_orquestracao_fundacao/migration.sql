-- Orquestração — Fase A (fundação): multi-prompt + variáveis flexíveis de lead.

-- 1) Lead.variaveis — JSON onde IA/fluxos gravam variáveis ({{custom.x}}).
ALTER TABLE "Lead" ADD COLUMN "variaveis" JSONB NOT NULL DEFAULT '{}';

-- 2) BotPrompt — biblioteca de prompts por empresa.
CREATE TABLE "BotPrompt" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "descricao" TEXT,
  "texto" TEXT NOT NULL,
  "modelo" TEXT,
  "temperatura" DOUBLE PRECISION DEFAULT 0.7,
  "isPadrao" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotPrompt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotPrompt_empresaId_nome_key" ON "BotPrompt"("empresaId", "nome");
CREATE INDEX "BotPrompt_empresaId_idx" ON "BotPrompt"("empresaId");
CREATE INDEX "BotPrompt_empresaId_isPadrao_idx" ON "BotPrompt"("empresaId", "isPadrao");

ALTER TABLE "BotPrompt" ADD CONSTRAINT "BotPrompt_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
