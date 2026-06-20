-- Camada de marketing do Produto (editável no app, fora do ERP) — Fatia 1 do app do rep.
-- tierComercial: tier livre por tenant (entrada/valor_agregado/nobre).
-- pesoPorUnidade: kg por unidade de venda — converte produtos não-kg pro mínimo por peso.
-- atributos: JSON livre de atributos customizados (ex: { "shelf_life_meses": 12 }).
ALTER TABLE "Produto" ADD COLUMN "tierComercial" TEXT;
ALTER TABLE "Produto" ADD COLUMN "pesoPorUnidade" DECIMAL(14,4);
ALTER TABLE "Produto" ADD COLUMN "atributos" JSONB;
