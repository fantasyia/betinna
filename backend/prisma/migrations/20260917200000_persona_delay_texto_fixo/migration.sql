-- Delay PRÓPRIO pro TEXTO FIXO do fluxo (`ENVIAR_WHATSAPP`).
--
-- O `delayRespostaSegundos` vale só pros nós de IA. O texto fixo vai direto pro
-- `enviarTexto` e sai em ~1s — e no caminho do cliente que VOLTA (`triado` +
-- `mb-explicado`) ele é a PRIMEIRA voz, então todo retorno era atendido
-- instantaneamente enquanto o resto da conversa andava no ritmo da persona.
--
-- Campo separado porque as duas esperas medem coisas diferentes: a da IA soma em
-- cima de uma composição que já leva 5–13s; a do texto fixo é a espera inteira.
--
-- DEFAULT 0 = comportamento de sempre. Ligar muda o ritmo de TODO nó
-- ENVIAR_WHATSAPP do tenant, e isso é escolha de quem configura — não pode
-- chegar por migration. Nenhum tenant existente muda de comportamento aqui.
ALTER TABLE "MullerBotPersona"
  ADD COLUMN IF NOT EXISTS "delayTextoFixoSegundos" INTEGER NOT NULL DEFAULT 0;
