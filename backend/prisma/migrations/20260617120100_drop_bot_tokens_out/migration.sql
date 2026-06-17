-- Migration: Dropar colunas mortas limiteTokensDiaOut e limiteTokensMesOut da MullerBotPersona
ALTER TABLE "MullerBotPersona" DROP COLUMN "limiteTokensDiaOut",
DROP COLUMN "limiteTokensMesOut";
