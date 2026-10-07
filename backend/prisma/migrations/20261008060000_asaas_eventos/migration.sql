-- Checkout Asaas (entrega 1): avisos de pagamento recebidos, com dedup pelo id
-- do evento. Só cria tabela — nada destrutivo.
CREATE TABLE IF NOT EXISTS "AsaasEvento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "pagamentoId" TEXT,
    "payload" JSONB NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "erro" TEXT,
    CONSTRAINT "AsaasEvento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AsaasEvento_empresaId_recebidoEm_idx" ON "AsaasEvento"("empresaId", "recebidoEm");
CREATE INDEX IF NOT EXISTS "AsaasEvento_pagamentoId_idx" ON "AsaasEvento"("pagamentoId");
