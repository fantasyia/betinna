-- DOCUMENTO ÚNICO (Anexo I, Grupo A — Leandro, 23/09): o que a proposta não guardava.
--
-- 1. O QUARTO prazo do item 08 (verificação de funcionamento). Os outros três
--    já existiam (entrega, instalação, software).
-- 2. Os SERVIÇOS DE IMPLANTAÇÃO, separados da locação. O documento cobra dois
--    negócios na mesma proposta: aluguel MENSAL (os itens) e serviços em valor
--    ÚNICO, em 2 parcelas (instalação + materiais + customização). Com um valor
--    só, o aluguel mensal sairia com a instalação somada dentro.
--
-- Tudo nulo por padrão: proposta de VENDA e as de locação antigas não têm isso,
-- e o montador do documento RECUSA o envio listando o que falta — nunca imprime
-- lacuna num documento que alguém assina.
ALTER TABLE "Proposta"
  ADD COLUMN IF NOT EXISTS "prazoVerificacaoDias" INTEGER,
  ADD COLUMN IF NOT EXISTS "servicosTotal" NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS "customizacaoUnitario" NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS "customizacaoQuantidade" INTEGER;
