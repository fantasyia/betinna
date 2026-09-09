-- QUEM fez ESTE pedido — separado de quem é o cliente hoje.
--
-- Num B2B o Cliente é a EMPRESA (casada por documento) e guarda UM contato.
-- Com dois compradores alternando pedidos, o cadastro fica com o do último e o
-- rastreio do pedido do primeiro saía pro telefone do segundo.
--
-- Sem backfill de propósito: o contato histórico de cada pedido não existe em
-- lugar nenhum, e copiar o do Cliente escreveria como fato o palpite que este
-- campo veio desfazer. Nulo = "não sei", e quem lê cai no contato do Cliente.
ALTER TABLE "Pedido" ADD COLUMN "contatoNome" TEXT;
ALTER TABLE "Pedido" ADD COLUMN "contatoEmail" TEXT;
ALTER TABLE "Pedido" ADD COLUMN "contatoTelefone" TEXT;
