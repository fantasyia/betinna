-- Amostra: modos (subsidiada/compra_propria/compra_cliente) + fila de aprovação.
-- ADD VALUE roda em PG12+ dentro da tx desde que não usemos o valor na mesma tx (só ALTER TABLE abaixo, que não usa).
ALTER TYPE "AmostraStatus" ADD VALUE IF NOT EXISTS 'PENDENTE_APROVACAO';
ALTER TYPE "AmostraStatus" ADD VALUE IF NOT EXISTS 'REJEITADA';

ALTER TABLE "Amostra"
  ADD COLUMN "modo" TEXT,
  ADD COLUMN "aprovadorId" TEXT,
  ADD COLUMN "aprovadorNome" TEXT,
  ADD COLUMN "aprovadoEm" TIMESTAMP(3),
  ADD COLUMN "motivoDecisao" TEXT,
  ADD COLUMN "mediaKgMes" DOUBLE PRECISION;
