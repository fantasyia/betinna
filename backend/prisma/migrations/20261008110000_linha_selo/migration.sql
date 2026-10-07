-- Selo da linha na vitrine (Léo, 07/10): ao tocar em Plus Size, a vitrine
-- mostra "Plus Size de verdade · veste até 150 kg ou mais…". Por linha, por
-- empresa; vazio = sem selo. Só ADICIONA coluna — nada destrutivo.
ALTER TABLE "CatalogoLinha" ADD COLUMN IF NOT EXISTS "selo" TEXT;

-- Ribelt Distribuidora: o selo do Plus Size (só se ainda não tiver um).
UPDATE "CatalogoLinha"
SET "selo" = 'Plus Size de verdade · veste até 150 kg ou mais (em média, varia conforme o biotipo)'
WHERE "empresaId" = 'cmuvkzvt8019flr5ia249uv88'
  AND lower(trim("nome")) = 'plus size'
  AND "selo" IS NULL;
