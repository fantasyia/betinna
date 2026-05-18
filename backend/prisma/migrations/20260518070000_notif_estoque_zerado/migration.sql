-- Novo valor de enum NotificacaoTipo: ESTOQUE_ZERADO.
-- Disparado quando produto transiciona estoque > 0 → estoque <= 0
-- via sync OMIE (cron 30min ou webhook). Notifica REPs que venderam
-- aquele produto nos últimos 30 dias.

ALTER TYPE "NotificacaoTipo" ADD VALUE 'ESTOQUE_ZERADO';
