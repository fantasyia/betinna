-- Interruptor SÓ do respondedor geral do WhatsApp.
--
-- `botWhatsappAtivo` gateia quatro coisas (respondedor, gatilho dos fluxos com
-- apenasComBotLigado, o nó CONVERSAR_IA e a UI) — desligar ali cala a triagem
-- junto. Este campo silencia apenas a resposta "de fora", deixando a conversa
-- 100% nas mãos dos fluxos. Padrão LIGADO: quem não configurar nada continua
-- exatamente como estava.
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "botGeralAtivo" BOOLEAN NOT NULL DEFAULT true;
