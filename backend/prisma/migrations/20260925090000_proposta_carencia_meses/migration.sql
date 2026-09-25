-- Carência em MESES (item b do documento único). Por proposta, sem padrão da casa (Léo, 25/09).
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "carenciaMeses" INTEGER;
