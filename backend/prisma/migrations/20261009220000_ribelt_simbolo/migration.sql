-- Símbolo da Ribelt (passarinho) ao lado do logo da vitrine (Léo, 09/10).
-- Só preenche se a marca da Ribelt Têxtil ainda não tem ícone: não
-- sobrescreve o que alguém tenha configurado depois.
UPDATE "Empresa"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{branding,iconeUrl}',
  '"https://atacado.ribelt.com.br/marcas/ribelt-simbolo.png"'::jsonb,
  true
)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88'
  AND "config" ? 'branding'
  AND COALESCE("config" #>> '{branding,iconeUrl}', '') = '';
