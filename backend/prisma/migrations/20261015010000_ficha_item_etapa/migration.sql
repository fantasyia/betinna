-- Ficha da OP pra imprimir (Léo, 14/10): cada item da ficha diz se vai pra
-- FACÇÃO (costura) ou pro ACABAMENTO (Isabela). Default facção. Só ADD.
ALTER TABLE "FichaTecnicaItem" ADD COLUMN IF NOT EXISTS "etapa" TEXT NOT NULL DEFAULT 'FACCAO';
