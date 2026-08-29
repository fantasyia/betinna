-- Comissão de ORIGINAÇÃO: a de quem trouxe o representante, não a de quem vendeu.
--
-- Uma linha por mês/empresa. Ela não cabe na tabela Comissao porque não é por
-- representante nem sai do `comissaoPadrao` de ninguém: o valor vem do
-- faturamento do período, com percentuais por canal (config do tenant).
--
-- O `contaPagarErpId` é o que impede provisionar o mesmo mês duas vezes — e
-- dinheiro duplicado só aparece na conciliação, semanas depois.
CREATE TABLE IF NOT EXISTS "ComissaoOriginacao" (
  "id"              TEXT NOT NULL,
  "empresaId"       TEXT NOT NULL,
  "ano"             INTEGER NOT NULL,
  "mes"             INTEGER NOT NULL,
  "valor"           NUMERIC(14,2) NOT NULL,
  "contaPagarErpId" TEXT,
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComissaoOriginacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ComissaoOriginacao_empresaId_ano_mes_key"
  ON "ComissaoOriginacao" ("empresaId", "ano", "mes");

ALTER TABLE "ComissaoOriginacao"
  DROP CONSTRAINT IF EXISTS "ComissaoOriginacao_empresaId_fkey";
ALTER TABLE "ComissaoOriginacao"
  ADD CONSTRAINT "ComissaoOriginacao_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
