-- Ação de fluxo TRANSFERIR_ATENDIMENTO — passa a conversa do bot pro humano no
-- MESMO número (atrito zero): atribui a conversa + PAUSA o bot + notifica.
-- É o nó que a branch financeiro/suporte da triagem chama.
--
-- ADD VALUE IF NOT EXISTS é idempotente; enum novo não afeta linha existente.
ALTER TYPE "FluxoAcaoTipo" ADD VALUE IF NOT EXISTS 'TRANSFERIR_ATENDIMENTO';
