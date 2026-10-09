-- Juros do parcelado da Ribelt Têxtil: 1% ao mês × parcelas, além da taxa do
-- Asaas (Léo, 09/10 — ele antecipa os recebíveis). Só grava se ainda não
-- houver valor: depois disso, quem manda é a tela (Pagamento online).
UPDATE "Empresa"
SET "config" = jsonb_set("config", '{checkout,jurosMesPct}', '1'::jsonb, true)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88'
  AND "config" ? 'checkout'
  AND ("config" #> '{checkout,jurosMesPct}') IS NULL;
