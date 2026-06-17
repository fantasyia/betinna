-- Drop da coluna legada RepCatalogoItem.markup (CLAUDE.md D5).
-- O rep não aplica markup desde 2026-06-16 (preço = o da empresa); a coluna virou
-- legada (default 0, não lida nem escrita no código). Drop é seguro.
ALTER TABLE "RepCatalogoItem" DROP COLUMN "markup";
