-- IA das pendências (fase 2, 25/10): histórico do que a IA respondeu ou escalou.
CREATE TABLE IF NOT EXISTS "PendenciaRespostaIa" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "pendenciaId" TEXT NOT NULL,
  "conversationId" TEXT,
  "acao" VARCHAR(20) NOT NULL,
  "resposta" TEXT NOT NULL,
  "motivo" VARCHAR(300),
  "enviada" BOOLEAN NOT NULL DEFAULT false,
  "erro" VARCHAR(500),
  "modelo" VARCHAR(60),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendenciaRespostaIa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PendenciaRespostaIa_empresaId_criadoEm_idx" ON "PendenciaRespostaIa"("empresaId", "criadoEm");
CREATE INDEX IF NOT EXISTS "PendenciaRespostaIa_pendenciaId_idx" ON "PendenciaRespostaIa"("pendenciaId");
