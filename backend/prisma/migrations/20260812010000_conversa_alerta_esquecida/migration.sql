-- Card 🔔 — alerta de CONVERSA ESQUECIDA.
--
-- Depois de uma transferência pra humano o bot NÃO volta sozinho (regra do
-- Léo): quem religa é o atendente. Se ele esquecer, a conversa fica MUDA — nem
-- bot, nem humano — e não existe erro em lugar nenhum pra alguém perceber.
--
-- Este carimbo marca quando o alerta foi disparado. Serve pra duas coisas ao
-- mesmo tempo: destacar a conversa no Inbox e impedir que a varredura de 15min
-- reabra tarefa a cada rodada. É limpo quando alguém responde ou religa o bot.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "alertaEsquecidaEm" TIMESTAMP(3);

-- Índice parcial: a varredura busca só as conversas AINDA não alertadas, e o
-- Inbox filtra as alertadas. Parcial porque a esmagadora maioria das linhas tem
-- NULL aqui — índice cheio seria desperdício.
CREATE INDEX IF NOT EXISTS "Conversation_alertaEsquecidaEm_idx"
  ON "Conversation" ("empresaId", "alertaEsquecidaEm")
  WHERE "alertaEsquecidaEm" IS NOT NULL;
