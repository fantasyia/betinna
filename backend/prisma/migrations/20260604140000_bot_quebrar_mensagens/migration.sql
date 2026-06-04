-- Quebra de resposta da IA em vários balões (mais humano no WhatsApp). Aditivo.
ALTER TABLE "MullerBotPersona"
  ADD COLUMN "quebrarMensagens" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maxMensagens" INTEGER NOT NULL DEFAULT 3;
