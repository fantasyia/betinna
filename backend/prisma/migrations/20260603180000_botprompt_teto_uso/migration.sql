-- Fase C — uso acumulado por prompt pra enforcement do teto de tokens (aditivo).
ALTER TABLE "BotPrompt"
  ADD COLUMN "usoTokensDia" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "usoDiaRef" TEXT,
  ADD COLUMN "usoTokensMes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "usoMesRef" TEXT;
