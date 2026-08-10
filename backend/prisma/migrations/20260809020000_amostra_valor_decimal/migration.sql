-- #B20: Amostra.valor era o ÚLTIMO campo monetário ainda em Float (double
-- precision) — todo o resto do dinheiro do app já é NUMERIC(14,2) desde a
-- migração #17. Float acumula erro de arredondamento e, em amostra, o valor vai
-- pra remessa fiscal do OMIE (valorReferencia).
--
-- USING explícito: o Postgres não converte double → numeric implicitamente num
-- ALTER TYPE, e o cast direto arredonda pelo valor binário. numeric(14,2) trunca
-- pro centavo, que é o que a coluna passa a representar.
ALTER TABLE "Amostra"
  ALTER COLUMN "valor" TYPE NUMERIC(14,2) USING "valor"::numeric(14,2);
