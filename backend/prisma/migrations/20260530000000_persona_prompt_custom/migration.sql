-- Persona do Muller: prompt completo escrito pelo usuário.
-- Quando preenchido, é usado como system prompt tal e qual (substitui o
-- prompt-base e os campos estruturados). Campo opcional, zero-impacto.
ALTER TABLE "MullerBotPersona" ADD COLUMN IF NOT EXISTS "promptCustom" TEXT;
