-- Ribelt Distribuidora: logo nominal no topo da vitrine e white-label no
-- domínio atacado.ribelt.com.br (login e app abertos por ele vestem a marca
-- Ribelt; e-mails de convite/senha da empresa linkam pra lá).
-- Só PREENCHE o que estiver vazio — valor já gravado no branding vence.
-- O domínio só entra se nenhuma outra empresa já o usa (a marca é resolvida
-- pelo host: dois donos pro mesmo domínio = marca errada pra um deles).
UPDATE "Empresa"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{branding}',
  jsonb_build_object('logoUrl', 'https://atacado.ribelt.com.br/marcas/ribelt-nominal.png')
    || CASE
         WHEN EXISTS (
           SELECT 1 FROM "Empresa" o
           WHERE o."id" <> 'cmuvkzvt8019flr5ia249uv88'
             AND lower(o."config" #>> '{branding,dominio}') = 'atacado.ribelt.com.br'
         ) THEN '{}'::jsonb
         ELSE jsonb_build_object('dominio', 'atacado.ribelt.com.br')
       END
    || jsonb_strip_nulls(COALESCE("config"->'branding', '{}'::jsonb)),
  true
)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88';
