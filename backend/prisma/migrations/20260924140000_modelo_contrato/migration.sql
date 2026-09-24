-- MODELO DO CONTRATO SUBIDO PELA TELA (Léo, 24/09): o diretor troca o .docx do
-- documento único sem deploy. Cada upload é uma VERSÃO guardada; só uma fica
-- ativa por empresa (garantido na ativação, em transação).
--
-- Sem versão ativa vale o modelo do repositório — nunca fica sem contrato.
CREATE TABLE IF NOT EXISTS "ModeloContrato" (
  "id"           TEXT         NOT NULL,
  "empresaId"    TEXT         NOT NULL,
  "versao"       INTEGER      NOT NULL,
  "nomeArquivo"  TEXT         NOT NULL,
  "storagePath"  TEXT         NOT NULL,
  "tamanhoBytes" INTEGER      NOT NULL,
  "sha256"       TEXT         NOT NULL,
  "ativo"        BOOLEAN      NOT NULL DEFAULT false,
  "observacao"   TEXT,
  "enviadoPorId" TEXT,
  "ativadoPorId" TEXT,
  "ativadoEm"    TIMESTAMP(3),
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModeloContrato_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ModeloContrato_empresaId_versao_key"
  ON "ModeloContrato"("empresaId", "versao");
CREATE INDEX IF NOT EXISTS "ModeloContrato_empresaId_ativo_idx"
  ON "ModeloContrato"("empresaId", "ativo");

DO $$ BEGIN
  ALTER TABLE "ModeloContrato"
    ADD CONSTRAINT "ModeloContrato_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
