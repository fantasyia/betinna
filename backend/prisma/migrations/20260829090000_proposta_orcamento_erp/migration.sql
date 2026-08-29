-- Proposta comercial sobe pro ERP como ORÇAMENTO.
-- `orcamentoErpId` é o que impede reenviar e criar uma segunda proposta pro
-- mesmo negócio (o cliente receberia dois números diferentes).
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "orcamentoErpId" TEXT;
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "enviadaErpEm" TIMESTAMP(3);
