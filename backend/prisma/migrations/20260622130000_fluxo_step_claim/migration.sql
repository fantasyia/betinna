-- Claim de idempotência por job.id do BullMQ (at-most-once por passo de fluxo).
-- Estado EXECUTANDO = passo em curso (retry de falha real re-executa);
-- CONCLUIDO = efeito consumado (retry pós-efeito pula o efeito). Keyed por jobId:
-- estável no retry do MESMO job, fresco a cada enqueue → não quebra loop/re-entrada.
CREATE TABLE "FluxoStepClaim" (
    "jobId" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "noId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'EXECUTANDO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    CONSTRAINT "FluxoStepClaim_pkey" PRIMARY KEY ("jobId")
);

CREATE INDEX "FluxoStepClaim_execucaoId_idx" ON "FluxoStepClaim"("execucaoId");
CREATE INDEX "FluxoStepClaim_estado_criadoEm_idx" ON "FluxoStepClaim"("estado", "criadoEm");
