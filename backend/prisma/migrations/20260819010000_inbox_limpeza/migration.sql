-- Marca de LIMPEZA da Inbox por (empresa, canal).
--
-- O PROBLEMA (produção, 18/08): o Léo apagou todas as conversas de WhatsApp às
-- 21:53:24. Às 21:54:00 — 36 segundos depois — elas voltaram inteiras, com as
-- mensagens de 21:45–21:47 dentro.
--
-- Causa: o tombstone que impede reimportação (`Conversation.mensagensZeradasEm`)
-- mora na PRÓPRIA conversa, e a limpeza geral APAGA a conversa. O tombstone
-- morria junto. Aí o poll de fallback do Evolution — que roda a cada minuto e
-- puxa mensagens de 45s a 12min atrás — reimportou tudo, criando conversas
-- novinhas, sem tombstone nenhum, prontas pra ressuscitar de novo.
--
-- Esta tabela sobrevive à exclusão: mensagem com timestamp anterior a `em` é
-- descartada na ingestão, para sempre.
CREATE TABLE IF NOT EXISTS "InboxLimpeza" (
  "id"        TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "canal"     "MessageChannel" NOT NULL,
  "em"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuarioId" TEXT,
  "criadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboxLimpeza_pkey" PRIMARY KEY ("id")
);

-- Uma marca por (empresa, canal): limpar de novo ATUALIZA a data, não acumula.
CREATE UNIQUE INDEX IF NOT EXISTS "InboxLimpeza_empresaId_canal_key"
  ON "InboxLimpeza"("empresaId", "canal");
CREATE INDEX IF NOT EXISTS "InboxLimpeza_empresaId_idx" ON "InboxLimpeza"("empresaId");

ALTER TABLE "InboxLimpeza"
  ADD CONSTRAINT "InboxLimpeza_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
