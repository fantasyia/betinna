-- Atribuição de marketing no Lead (pré-requisito das campanhas).
-- Colunas NULLABLE, SEM backfill: os 27k+ leads existentes ficam null — o dado
-- de atribuição não existe pra eles (origemCadastro antigo = null, NÃO "site").
--
-- Modelagem (aprovada): utmSource/utmMedium/utmCampaign como COLUNAS indexáveis
-- (creditam a campanha, são a chave de junção das consultas); o resto do 1º toque
-- + o ÚLTIMO toque inteiro moram em Lead.variaveis.atribuicao (JSON).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmSource"        TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmMedium"        TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "utmCampaign"      TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "origemCadastro"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "formularioOrigem" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "valorFechado"     NUMERIC(14,2);

-- Índices COMPOSTOS multi-tenant: toda consulta de campanha filtra por empresaId
-- ANTES de agrupar por utmCampaign/origemCadastro. Índice simples não serve.
CREATE INDEX IF NOT EXISTS "Lead_empresaId_utmCampaign_idx"
  ON "Lead" ("empresaId", "utmCampaign");
CREATE INDEX IF NOT EXISTS "Lead_empresaId_origemCadastro_idx"
  ON "Lead" ("empresaId", "origemCadastro");
