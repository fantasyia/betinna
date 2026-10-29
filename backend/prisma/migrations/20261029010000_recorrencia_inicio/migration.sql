-- Recorrente com "começa em" (29/10): vencimento antes do início não é gerado.
-- Coluna nova e opcional; null = comportamento de hoje.
ALTER TABLE "FinRecorrencia" ADD COLUMN IF NOT EXISTS "inicio" DATE;
