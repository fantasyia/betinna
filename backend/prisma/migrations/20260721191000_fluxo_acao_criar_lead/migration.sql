-- Ação de fluxo CRIAR_LEAD — o elo que faltava entre a CONVERSA e o LEAD.
--
-- Hoje o inbound de WhatsApp só cria Conversation/Message; Lead nenhum. A triagem
-- do Click-to-WhatsApp precisa de um passo explícito que promova a conversa a lead
-- HERDANDO a atribuição já gravada nela (utmCampaign/ctwa). Se o lead nascer sem
-- herdar, a campanha que trouxe o contato se perde — e esse dado não volta.
--
-- ADD VALUE IF NOT EXISTS é idempotente; enum novo não afeta linha existente.
ALTER TYPE "FluxoAcaoTipo" ADD VALUE IF NOT EXISTS 'CRIAR_LEAD';
