-- Marca de limpeza POR DONO da caixa.
--
-- Até aqui a marca era só (empresa, canal): existia uma caixa só. Com o WhatsApp
-- dual-owner (número da empresa + WhatsApp pessoal de cada rep), o rep precisa
-- poder zerar o histórico DELE — e a marca dele não pode barrar o inbound da
-- empresa nem o dos outros reps.
--
-- `proprietarioId` como string NÃO-NULA com default '' (e não nullable) de
-- propósito: no Postgres, NULL é distinto de NULL num índice único, então uma
-- coluna nullable na chave deixaria criar linhas duplicadas pra mesma empresa —
-- e aí a marca da empresa viraria várias, com a leitura pegando qualquer uma.
-- '' = caixa da empresa; id do usuário = caixa pessoal dele.
ALTER TABLE "InboxLimpeza"
  ADD COLUMN IF NOT EXISTS "proprietarioId" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "InboxLimpeza_empresaId_canal_key";

CREATE UNIQUE INDEX IF NOT EXISTS "InboxLimpeza_empresaId_canal_proprietarioId_key"
    ON "InboxLimpeza" ("empresaId", "canal", "proprietarioId");
