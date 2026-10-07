-- Léo (07/10): "quero que mude tudo onde estiver escrito distribuidora,
-- deixar apenas têxtil". O que o lojista/cliente vê vem do nome da empresa
-- (a vitrine cai nele quando a marca não tem nome próprio) e da marca.
-- Só dados; condicionado ao valor antigo — rodar de novo não faz nada.
UPDATE "Empresa"
SET "nome" = 'Ribelt Têxtil'
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88'
  AND "nome" = 'Ribelt Distribuidora Têxtil';

-- Marca: se algum dia ganhar nome com "Distribuidora", também vira "Ribelt Têxtil".
UPDATE "Empresa"
SET "config" = jsonb_set("config", '{branding,nome}', '"Ribelt Têxtil"')
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88'
  AND "config" -> 'branding' ->> 'nome' ILIKE '%distribuidora%';
