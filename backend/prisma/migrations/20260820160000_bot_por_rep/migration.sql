-- Bot por representante: persona e prompts ganham DONO.
-- '' = bot/biblioteca da EMPRESA (comportamento de sempre); id de usuário =
-- bot PESSOAL do rep (responde no WhatsApp dele, com a chave OpenAI dele).
-- '' e não NULL de propósito: NULL em índice único no Postgres não deduplica.

ALTER TABLE "MullerBotPersona" ADD COLUMN "usuarioId" TEXT NOT NULL DEFAULT '';
DROP INDEX "MullerBotPersona_empresaId_key";
CREATE UNIQUE INDEX "MullerBotPersona_empresaId_usuarioId_key"
  ON "MullerBotPersona"("empresaId", "usuarioId");

ALTER TABLE "BotPrompt" ADD COLUMN "usuarioId" TEXT NOT NULL DEFAULT '';
-- O nome do prompt só precisa ser único DENTRO da biblioteca de cada dono —
-- o rep pode chamar o dele de "Padrão" sem colidir com o da empresa.
DROP INDEX "BotPrompt_empresaId_nome_key";
CREATE UNIQUE INDEX "BotPrompt_empresaId_usuarioId_nome_key"
  ON "BotPrompt"("empresaId", "usuarioId", "nome");
DROP INDEX "BotPrompt_empresaId_isPadrao_idx";
CREATE INDEX "BotPrompt_empresaId_usuarioId_isPadrao_idx"
  ON "BotPrompt"("empresaId", "usuarioId", "isPadrao");
