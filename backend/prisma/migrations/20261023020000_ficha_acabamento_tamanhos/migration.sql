-- Acabamento por tamanho (Léo, 23/10): capuz infantil 2/4/6 sem cordão nem ilhós. Só ADD.
ALTER TABLE "FichaTecnica" ADD COLUMN IF NOT EXISTS "acabamentoTamanhos" JSONB;
