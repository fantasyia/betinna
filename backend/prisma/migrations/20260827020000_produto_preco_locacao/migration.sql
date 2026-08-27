-- Mensalidade de locação por equipamento.
--
-- O representante LOCA, não vende — e não pode ver preço de venda (regra do
-- Léo, 26/08). Sem um campo próprio, o catálogo dele mostraria `precoTabela`,
-- que é justamente o número que ele não deve ver.
--
-- NULLABLE de propósito: null = "não definido", e a tela mostra "—". Cair pro
-- preço de venda como fallback seria pior que não mostrar nada.
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "precoLocacaoMensal" NUMERIC(14,2);
