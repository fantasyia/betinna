-- Pacote de config do bot (aditivo).
-- Persona: histórico de contexto, delay de resposta, indicador "digitando".
ALTER TABLE "MullerBotPersona"
  ADD COLUMN "historicoMensagens" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "delayRespostaSegundos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mostrarDigitando" BOOLEAN NOT NULL DEFAULT false;

-- Conversa: override do bot por conversa (NULL = segue o global).
ALTER TABLE "Conversation" ADD COLUMN "botLigado" BOOLEAN;
