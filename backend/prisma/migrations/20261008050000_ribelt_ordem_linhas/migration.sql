-- Ribelt Distribuidora: ordem das linhas na vitrine pedida pelo Léo (07/10):
-- Infantil → Regular → Plus Size (a 1ª é a que abre selecionada). Só as três
-- linhas desta empresa, pelo nome; linha com outro nome não é tocada.
UPDATE "CatalogoLinha"
SET "ordem" = CASE lower(trim("nome"))
  WHEN 'infantil' THEN 0
  WHEN 'regular' THEN 1
  WHEN 'plus size' THEN 2
END
WHERE "empresaId" = 'cmuvkzvt8019flr5ia249uv88'
  AND lower(trim("nome")) IN ('infantil', 'regular', 'plus size');
