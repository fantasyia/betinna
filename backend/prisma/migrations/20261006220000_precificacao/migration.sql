-- Calculadora de precificação (Ribelt Distribuidora Têxtil, card cmuwz849800e1ph5i3ynsbmcd).
--
-- 1. Custo por peça na Linha do modelo — só ADMIN/DIRECTOR veem; a vitrine
--    pública NÃO o lê. Só ADD COLUMN nullable: o container antigo ignora.
ALTER TABLE "CatalogoModeloLinha" ADD COLUMN IF NOT EXISTS "custoPorPeca" DECIMAL(14,2);
ALTER TABLE "CatalogoModeloLinha" ADD COLUMN IF NOT EXISTS "custoAtualizadoEm" TIMESTAMP(3);

-- 2. Liga a calculadora SÓ na Distribuidora (Léo, 06/10: "por enquanto,
--    habilite só pra distribuidora"). A chave `precificacao` não está no schema
--    do PATCH /empresas/config, então ninguém liga pela tela — só aqui.
--    Funde com o que já existir na seção (não apaga taxas já salvas).
UPDATE "Empresa"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{precificacao}',
  COALESCE("config"->'precificacao', '{}'::jsonb) || '{"ativa": true}'::jsonb,
  true
)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88';
