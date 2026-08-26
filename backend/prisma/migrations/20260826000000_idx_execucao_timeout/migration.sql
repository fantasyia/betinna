-- Varredura de timeout do CONVERSAR_IA passou a rodar a cada 1min (antes 30min,
-- que arredondava o prazo configurado pra cima). A consulta é global:
--   status = 'AGUARDANDO' AND "timeoutEm" < now()
-- Sem este índice ela vira seq scan da tabela inteira uma vez por minuto.
CREATE INDEX IF NOT EXISTS "FluxoExecucao_status_timeoutEm_idx"
  ON "FluxoExecucao"("status", "timeoutEm");
