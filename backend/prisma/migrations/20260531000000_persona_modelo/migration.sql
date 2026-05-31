-- Persona do Muller: modelo da OpenAI escolhido por empresa.
-- Quando null, usa o padrão do servidor (env MULLERBOT_MODEL). Zero-impacto.
ALTER TABLE "MullerBotPersona" ADD COLUMN IF NOT EXISTS "modelo" TEXT;
