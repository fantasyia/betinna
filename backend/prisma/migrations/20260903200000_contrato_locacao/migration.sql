-- Contrato de LOCAÇÃO: a venda do rep vira contrato recorrente no ERP, não
-- pedido avulso. É o contrato que gera os pedidos/notas mensais, e é isso que
-- dá lastro à comissão do rep mês a mês.

-- 1) Proposta ganha o que faltava pra virar contrato. Nulos em VENDA.
ALTER TABLE "Proposta"
  ADD COLUMN IF NOT EXISTS "prazoMeses"    INTEGER,
  ADD COLUMN IF NOT EXISTS "diaVencimento" INTEGER,
  ADD COLUMN IF NOT EXISTS "carenciaDias"  INTEGER;

-- 2) Ciclo de vida do contrato.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContratoStatus') THEN
    CREATE TYPE "ContratoStatus" AS ENUM (
      'RASCUNHO', 'AGUARDANDO_ASSINATURA', 'ASSINADO', 'ATIVO', 'ENCERRADO', 'CANCELADO'
    );
  END IF;
END $$;

-- 3) O contrato em si.
CREATE TABLE IF NOT EXISTS "Contrato" (
  "id"                 TEXT NOT NULL,
  "empresaId"          TEXT NOT NULL,
  "propostaId"         TEXT NOT NULL,
  "clienteId"          TEXT NOT NULL,
  "representanteId"    TEXT,
  "status"             "ContratoStatus" NOT NULL DEFAULT 'RASCUNHO',
  "valorMensal"        NUMERIC(14,2) NOT NULL,
  "prazoMeses"         INTEGER NOT NULL,
  "diaVencimento"      INTEGER NOT NULL,
  "primeiraCobrancaEm" TIMESTAMP(3),
  "contratoErpId"      TEXT,
  "enviadoErpEm"       TIMESTAMP(3),
  "assinaturaId"       TEXT,
  "assinaturaUrl"      TEXT,
  "assinadoEm"         TIMESTAMP(3),
  "documentoUrl"       TEXT,
  "encerradoEm"        TIMESTAMP(3),
  "motivoEncerramento" TEXT,
  "criadoEm"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- Uma proposta = um contrato. É este unique que impede aprovar duas vezes
-- virar duas cobranças mensais no mesmo cliente.
CREATE UNIQUE INDEX IF NOT EXISTS "Contrato_propostaId_key"   ON "Contrato"("propostaId");
CREATE UNIQUE INDEX IF NOT EXISTS "Contrato_assinaturaId_key" ON "Contrato"("assinaturaId");
CREATE INDEX IF NOT EXISTS "Contrato_empresaId_status_idx"    ON "Contrato"("empresaId", "status");
CREATE INDEX IF NOT EXISTS "Contrato_clienteId_idx"           ON "Contrato"("clienteId");
CREATE INDEX IF NOT EXISTS "Contrato_representanteId_idx"     ON "Contrato"("representanteId");

ALTER TABLE "Contrato"
  ADD CONSTRAINT "Contrato_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contrato"
  ADD CONSTRAINT "Contrato_propostaId_fkey"
  FOREIGN KEY ("propostaId") REFERENCES "Proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contrato"
  ADD CONSTRAINT "Contrato_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contrato"
  ADD CONSTRAINT "Contrato_representanteId_fkey"
  FOREIGN KEY ("representanteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
