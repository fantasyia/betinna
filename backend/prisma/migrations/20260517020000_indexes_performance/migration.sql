-- Auditoria 2026-05-17: indexes pra queries pesadas em produção.
-- Identificadas via análise de queries comuns em RelatoriosService + dashboards.

-- Pedido — dashboard de vendas (group by status, criadoEm range, com filtro de tenant)
CREATE INDEX IF NOT EXISTS "Pedido_empresaId_status_criadoEm_idx"
  ON "Pedido"("empresaId", "status", "criadoEm");
CREATE INDEX IF NOT EXISTS "Pedido_empresaId_criadoEm_idx"
  ON "Pedido"("empresaId", "criadoEm");

-- Cliente — lista cronológica + dashboard "novos clientes"
CREATE INDEX IF NOT EXISTS "Cliente_empresaId_criadoEm_idx"
  ON "Cliente"("empresaId", "criadoEm");

-- Lead — aging por etapa (dashboard funil)
CREATE INDEX IF NOT EXISTS "Lead_empresaId_etapa_etapaDesde_idx"
  ON "Lead"("empresaId", "etapa", "etapaDesde");

-- Ocorrencia — SLA dashboard + severidade
CREATE INDEX IF NOT EXISTS "Ocorrencia_empresaId_severidade_idx"
  ON "Ocorrencia"("empresaId", "severidade");
CREATE INDEX IF NOT EXISTS "Ocorrencia_empresaId_slaVenceEm_idx"
  ON "Ocorrencia"("empresaId", "slaVenceEm");

-- Comissao — relatório mensal + filtro pago
CREATE INDEX IF NOT EXISTS "Comissao_empresaId_ano_mes_idx"
  ON "Comissao"("empresaId", "ano", "mes");
CREATE INDEX IF NOT EXISTS "Comissao_empresaId_pago_idx"
  ON "Comissao"("empresaId", "pago");
