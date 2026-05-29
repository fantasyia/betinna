-- Lote 6 — P7 (remessa de amostra grátis pro OMIE — CFOP 5911/6911)
-- Todas as colunas são opcionais ou têm default → zero impacto nas amostras existentes.

-- ───────────────────────────────────────────────────────────────────────────
-- Amostra ganha vínculo opcional com Produto + dados de remessa fiscal/OMIE.
--   produtoId      → FK opcional pro Produto (necessária só pra enviar ao OMIE)
--   quantidade     → quantidade enviada (default 1; amostra = qtd reduzida)
--   cfop           → CFOP usado na remessa ("5911" mesma UF / "6911" interestadual)
--   numeroOmie     → número da remessa retornado pelo OMIE (null = não enviada)
--   enviadoOmieEm  → timestamp do envio
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "Amostra"
  ADD COLUMN "produtoId"     TEXT,
  ADD COLUMN "quantidade"    DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "cfop"          TEXT,
  ADD COLUMN "numeroOmie"    TEXT,
  ADD COLUMN "enviadoOmieEm" TIMESTAMP(3);

CREATE INDEX "Amostra_produtoId_idx" ON "Amostra"("produtoId");

ALTER TABLE "Amostra"
  ADD CONSTRAINT "Amostra_produtoId_fkey"
    FOREIGN KEY ("produtoId") REFERENCES "Produto"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
