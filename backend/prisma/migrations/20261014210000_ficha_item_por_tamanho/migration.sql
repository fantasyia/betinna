-- Quantidade POR TAMANHO num item da ficha (Léo, 14/10): o elástico muda em
-- cada tamanho (P 76 cm, M 80 cm…). { "P": 0.76, "M": 0.80 } na unidade do
-- insumo; o consumoPorPeca vira a média (custo previsto da grade). Só ADD.
ALTER TABLE "FichaTecnicaItem" ADD COLUMN IF NOT EXISTS "porTamanho" JSONB;
