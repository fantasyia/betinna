-- Ribelt Distribuidora: identidade visual no login e no app do domínio
-- atacado.ribelt.com.br (pedido do Léo, 07/10) — as cores da vitrine:
-- fundo creme (tema claro no login), petróleo no texto/botão, terracota de
-- destaque. Só grava se a empresa ainda não tem cores próprias.
UPDATE "Empresa"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{branding,cores}',
  '{"primaria": "#1a2d38", "secundaria": "#8a6a55", "acao": "#1a2d38", "fundo": "#f8f1e0"}'::jsonb,
  true
)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88'
  AND "config" ? 'branding'
  AND NOT ("config"->'branding' ? 'cores');
