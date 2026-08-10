-- Amostra.observacaoStatus: o DTO do change-status já aceitava `observacao`
-- (max 500) e o service descartava — a API respondia 200 e o motivo da
-- não-conversão evaporava. Coluna nullable, aditiva, sem backfill.
ALTER TABLE "Amostra" ADD COLUMN IF NOT EXISTS "observacaoStatus" TEXT;
