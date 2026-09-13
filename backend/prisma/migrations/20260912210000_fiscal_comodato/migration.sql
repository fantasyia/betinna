-- Valor do BEM, para a NF de comodato da locação.
--
-- ⚠️ NÃO confundir com `precoLocacaoMensal`: aquele é o ALUGUEL (o que o cliente
-- paga por mês), este é quanto o equipamento VALE. A NF de remessa em comodato
-- leva o valor do bem — mandar a mensalidade ali declara um patrimônio de R$ 522
-- saindo da empresa quando o equipamento vale muito mais, e é a nota que fica.
--
-- Nulo é o estado normal até a contabilidade definir: sem ele a NF de comodato
-- é RECUSADA pelo app, em vez de sair com número inventado.
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "valorBem" NUMERIC(14,2);
