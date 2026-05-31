-- Fase 2 — Bot Muller no WhatsApp da empresa.
-- Todas as colunas são opcionais ou têm default → zero impacto nos dados existentes.

-- Conversation: estado do bot por conversa (pausa do handoff + precisa-humano)
ALTER TABLE "Conversation"
  ADD COLUMN "botPausadoAte" TIMESTAMP(3),
  ADD COLUMN "precisaHumano" BOOLEAN NOT NULL DEFAULT false;

-- Message: marca mensagens enviadas pelo bot (indicador visual 🤖)
ALTER TABLE "Message"
  ADD COLUMN "enviadaPorBot" BOOLEAN NOT NULL DEFAULT false;

-- Empresa: liga/desliga global do bot no WhatsApp (padrão ligado)
ALTER TABLE "Empresa"
  ADD COLUMN "botWhatsappAtivo" BOOLEAN NOT NULL DEFAULT true;
