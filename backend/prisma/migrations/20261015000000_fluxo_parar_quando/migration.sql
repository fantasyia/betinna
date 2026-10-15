-- Parar a régua (Léo + #01, 14/10): o fluxo marca quando a régua dele para pro
-- lead (RESPONDEU, COMPROU, MUDOU_FUNIL, HUMANO). Vazio = nunca para. Só ADD.
ALTER TABLE "Fluxo" ADD COLUMN IF NOT EXISTS "pararQuando" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
