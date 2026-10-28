-- Ficha técnica (Léo, 27/10): o mesmo insumo em mais de uma linha, cada uma com
-- o seu USO na peça (elástico no cós E na barra). Sem migração de dados.
ALTER TABLE "FichaTecnicaItem" ADD COLUMN IF NOT EXISTS "uso" VARCHAR(60);

-- Sai o único (fichaId, insumoId). Seguro: o código antigo não depende dele (o
-- DTO antigo já recusa insumo repetido) e nada lê por essa chave.
DROP INDEX IF EXISTS "FichaTecnicaItem_fichaId_insumoId_key";

-- O único servia de índice pra ler os itens da ficha; fica um índice simples.
CREATE INDEX IF NOT EXISTS "FichaTecnicaItem_fichaId_idx" ON "FichaTecnicaItem"("fichaId");
