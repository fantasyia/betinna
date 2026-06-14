-- precoFabrica (custo / preço de fábrica) passa a ser OPCIONAL.
--
-- Motivo: quando um produto vem do OMIE sem custo real, o sistema preenchia
-- precoFabrica = precoTabela * 0,70 — um chute que aparecia na tela COMO SE fosse
-- o custo real e distorcia o markup do catálogo (preço final = custo × (1+markup)).
-- Agora paramos de inventar: sem custo real, o campo fica NULL ("não informado").
--
-- Seguro: relaxa a constraint (NOT NULL -> NULL). Todo dado existente já satisfaz
-- (tem valor). Não apaga nada — só permite null daqui pra frente.

ALTER TABLE "Produto" ALTER COLUMN "precoFabrica" DROP NOT NULL;
