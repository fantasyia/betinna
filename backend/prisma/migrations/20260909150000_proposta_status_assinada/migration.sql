-- Proposta ASSINADA — o contrato voltou assinado.
--
-- Separado de ACEITA porque são fatos diferentes: aceite é o cliente dizendo
-- "quero" (pedido nasce rascunho); assinatura é o documento existindo (pedido
-- trava, comissão entra no cronograma, contrato sobe pro ERP). Com um status
-- só, olhar a proposta não dizia se o contrato tinha voltado.
--
-- Vale só pra LOCAÇÃO. Venda continua terminando em ACEITA — por isso NÃO há
-- migração de dado: nenhuma proposta existente vira ASSINADA retroativamente.
ALTER TYPE "PropostaStatus" ADD VALUE IF NOT EXISTS 'ASSINADA';
