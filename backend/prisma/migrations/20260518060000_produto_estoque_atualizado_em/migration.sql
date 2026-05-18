-- Rastreia quando o estoque foi atualizado pela última vez (sync 30min OU webhook OMIE).
-- Frontend usa pra mostrar "atualizado há X min" e detectar dados stale.

ALTER TABLE "Produto" ADD COLUMN "estoqueAtualizadoEm" TIMESTAMP(3);
