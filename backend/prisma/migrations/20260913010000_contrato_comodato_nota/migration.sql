-- NF de comodato: a remessa que tira o equipamento da empresa e o põe na planta
-- do cliente, sem venda.
--
-- Ela sai SEMPRE do pedido de venda (decisão do Léo, 12/09) — nunca avulsa.
-- Guardar o id aqui é o que torna a emissão IDEMPOTENTE: nota fiscal não tem
-- desfazer pela API do Tiny (sem segunda nota pro mesmo pedido, sem endpoint de
-- alterar), então "já emitiu?" precisa ser pergunta que o app responde sozinho.
ALTER TABLE "Contrato" ADD COLUMN IF NOT EXISTS "comodatoNotaId" TEXT;
ALTER TABLE "Contrato" ADD COLUMN IF NOT EXISTS "comodatoNotaNumero" TEXT;
ALTER TABLE "Contrato" ADD COLUMN IF NOT EXISTS "comodatoEmitidaEm" TIMESTAMP(3);
