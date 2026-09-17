-- Produto.vendavel — separa "pode ser vendido" de "tem preço cadastrado".
--
-- Até aqui a regra de não-venda era implícita: `precoTabela == 0` significava
-- "produto de locação". Em 15/09/2026 isso quebrou de um jeito silencioso: a API
-- v2 do Tiny recusa QUALQUER alteração em produto com `preco` 0 (inclusive só
-- gravar NCM), então cumprir a exigência fiscal das 24 variantes obrigou a dar
-- preço a elas — e o sync espelha `preco` do ERP em `precoTabela`, o que
-- desarmaria a trava de venda sem erro nenhum.
--
-- O backfill reproduz EXATAMENTE a regra antiga no instante da migração: quem
-- está com preço de venda zero hoje é quem já era recusado hoje. Nada muda de
-- comportamento na virada; o que muda é que a decisão passa a ser um dado
-- próprio, e não um efeito colateral de um campo que o ERP pode sobrescrever.
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "vendavel" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Produto" SET "vendavel" = false WHERE "precoTabela" = 0;

-- REDE PARA UMA CORRIDA REAL: o backfill acima lê `precoTabela`, que é espelho
-- do ERP e muda sozinho. As 24 variantes `_D.S.`/`_E.P.` ganharam preço no Tiny
-- em 15/09 só para satisfazer a exigência fiscal (a API v2 recusa gravar NCM em
-- produto com preço 0). Se o sync trouxer esse preço ANTES desta migration
-- rodar, a linha acima não pega nenhuma delas — e elas nascem vendáveis, que é
-- exatamente o contrário do que a empresa decidiu.
--
-- Por isso a segunda passada usa o que NÃO muda: ter mensalidade de locação e
-- ser uma das variantes de módulo IoT. É correção histórica pontual, não regra
-- de produto — daí estar aqui e não no código.
UPDATE "Produto" SET "vendavel" = false
WHERE "precoLocacaoMensal" IS NOT NULL
  AND ("sku" LIKE '%\_D.S.' ESCAPE '\' OR "sku" LIKE '%\_E.P.' ESCAPE '\');
