-- Sucessores que o passo decidiu enfileirar, gravados ANTES do enqueue.
-- Sem isto não há como recuperar a navegação quando o enqueue falha depois de o
-- claim já estar CONCLUIDO: o retry pula o passo (certo, pra não reenviar
-- WhatsApp) e volta verde sem enfileirar ninguém — a execução morre em
-- EM_EXECUCAO, sem erro e sem alarme, e o lead fica sem resposta.
ALTER TABLE "FluxoStepClaim" ADD COLUMN IF NOT EXISTS "proximos" TEXT[] NOT NULL DEFAULT '{}';
