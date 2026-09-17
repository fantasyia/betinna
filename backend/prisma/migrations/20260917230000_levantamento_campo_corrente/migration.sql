-- LEVANTAMENTO DE CAMPO → PROPOSTA TÉCNICA (Anexo II)
--
-- O rep mede o quadro do cliente e isso vira a tabela "ITEM / QUADRO-PAINEL /
-- TENSÃO / CORRENTE / MODELO" da proposta técnica. Dois lados:
--
-- 1. o ITEM guarda o que foi medido (quadro, tensão, corrente);
-- 2. o PRODUTO guarda a faixa de corrente que ele atende — é ela que SELECIONA
--    o modelo (MB-01 = 1–125A, MB-02 = 126–250A, …).
--
-- 📌 A faixa mora no produto, não numa tabela no código: é dado de catálogo e
-- muda quando o Leandro revisa a linha. Assim a revisão é uma edição, e existe
-- UMA fonte — a duplicação entre app e site já divergiu antes (o site mostra
-- 220–690V, a tabela 2026 diz 110–1100V; aberto desde julho).
ALTER TABLE "Produto"
  ADD COLUMN IF NOT EXISTS "correnteMinA" INTEGER,
  ADD COLUMN IF NOT EXISTS "correnteMaxA" INTEGER;

ALTER TABLE "PropostaItem"
  ADD COLUMN IF NOT EXISTS "quadroPainel" TEXT,
  ADD COLUMN IF NOT EXISTS "tensaoV" INTEGER,
  ADD COLUMN IF NOT EXISTS "correnteA" INTEGER;

-- Faixas oficiais (doc do Leandro, "TABELA DE POTÊNCIAS MASTER BLOCK MB-01..MB-12
-- — 2026"). Todos os 12 cobrem a mesma faixa de TENSÃO (110V a 1100V) e se
-- diferenciam pela CORRENTE.
--
-- O `LIKE 'MB-01%'` alcança de propósito as variantes `MB-01_D.S.` e
-- `MB-01_E.P.`: o Data Sense e o End Point acompanham o MB daquela faixa, então
-- herdam a mesma seleção. Sem isso, escolher a variante com hardware deixaria o
-- seletor cego.
--
-- ⚠️ Só preenche o que está VAZIO (`correnteMinA IS NULL`). Se alguém já ajustou
-- uma faixa à mão, esta migration não passa por cima.
UPDATE "Produto" SET "correnteMinA" =    1, "correnteMaxA" =  125 WHERE "sku" LIKE 'MB-01%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" =  126, "correnteMaxA" =  250 WHERE "sku" LIKE 'MB-02%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" =  251, "correnteMaxA" =  400 WHERE "sku" LIKE 'MB-03%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" =  401, "correnteMaxA" =  500 WHERE "sku" LIKE 'MB-04%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" =  501, "correnteMaxA" =  630 WHERE "sku" LIKE 'MB-05%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" =  631, "correnteMaxA" =  800 WHERE "sku" LIKE 'MB-06%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" =  801, "correnteMaxA" = 1000 WHERE "sku" LIKE 'MB-07%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" = 1001, "correnteMaxA" = 1250 WHERE "sku" LIKE 'MB-08%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" = 1251, "correnteMaxA" = 1600 WHERE "sku" LIKE 'MB-09%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" = 1601, "correnteMaxA" = 2500 WHERE "sku" LIKE 'MB-10%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" = 2501, "correnteMaxA" = 3200 WHERE "sku" LIKE 'MB-11%' AND "correnteMinA" IS NULL;
UPDATE "Produto" SET "correnteMinA" = 3201, "correnteMaxA" = 6300 WHERE "sku" LIKE 'MB-12%' AND "correnteMinA" IS NULL;
