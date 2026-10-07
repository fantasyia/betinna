-- Ribelt Distribuidora: preview do link (WhatsApp etc.) com a marca dela, não
-- a do Betinna. O servidor do front (frontend/server.mjs) escreve isto no HTML
-- que o robô do preview lê. Só PREENCHE o que estiver vazio — valor já gravado
-- no branding vence.
UPDATE "Empresa"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{branding}',
  jsonb_build_object(
    'tituloApp', 'Ribelt Atacado',
    'descricao', 'Moda masculina no atacado, direto da produção. Escolha modelos, cores e tamanhos e veja o seu lucro de revenda.',
    'imagemCompartilhamento', 'https://atacado.ribelt.com.br/marcas/ribelt-og.png'
  ) || jsonb_strip_nulls(COALESCE("config"->'branding', '{}'::jsonb)),
  true
)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88';
