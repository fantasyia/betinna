-- Histórico IRREVERSÍVEL de transição de etapa do Lead.
-- "Transição não registrada é transição perdida": hoje só há Lead.etapaDesde
-- (data de entrada na etapa ATUAL). Esta tabela guarda a trajetória inteira.
CREATE TABLE IF NOT EXISTS "LeadEtapaHistorico" (
  "id"            TEXT NOT NULL,
  "empresaId"     TEXT NOT NULL,
  "leadId"        TEXT NOT NULL,
  "funilId"       TEXT,
  "etapaOrigem"   TEXT,
  "etapaDestino"  TEXT,
  "quem"          TEXT,
  "origemMudanca" TEXT NOT NULL,
  "ocorridoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadEtapaHistorico_pkey" PRIMARY KEY ("id")
);

-- FK pro Lead (cascade: apagar lead limpa o histórico dele).
ALTER TABLE "LeadEtapaHistorico"
  ADD CONSTRAINT "LeadEtapaHistorico_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "LeadEtapaHistorico_leadId_ocorridoEm_idx"
  ON "LeadEtapaHistorico" ("leadId", "ocorridoEm");
CREATE INDEX IF NOT EXISTS "LeadEtapaHistorico_empresaId_funilId_ocorridoEm_idx"
  ON "LeadEtapaHistorico" ("empresaId", "funilId", "ocorridoEm");

-- SEED: 1 registro inicial por lead EXISTENTE com a etapa atual + a data de
-- entrada conhecida (etapaDesde). etapaOrigem=null (não sabemos a trajetória
-- anterior — não inventa). id determinístico 'seed_<leadId>' + ON CONFLICT →
-- idempotente (re-rodar não duplica). origemMudanca='seed' distingue dos reais.
INSERT INTO "LeadEtapaHistorico"
  ("id", "empresaId", "leadId", "funilId", "etapaOrigem", "etapaDestino", "quem", "origemMudanca", "ocorridoEm", "criadoEm")
SELECT 'seed_' || l."id", l."empresaId", l."id", l."funilId",
       NULL, COALESCE(l."funilEtapaId", l."etapa"::text), NULL, 'seed',
       l."etapaDesde", CURRENT_TIMESTAMP
FROM "Lead" l
ON CONFLICT ("id") DO NOTHING;
