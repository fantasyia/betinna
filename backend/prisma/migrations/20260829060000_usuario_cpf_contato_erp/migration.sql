-- Documento do usuário e vínculo com o contato do ERP.
--
-- O representante precisa existir como CONTATO no Tiny (é assim que ele vira
-- vendedor lá e que o pedido dele casa de volta com o app). O documento é a
-- chave: nome varia — "Marcelo", "Marcelo Harada", "M. Harada" — e cada
-- variação criaria um contato novo, espalhando histórico e comissão.
--
-- `contatoErpId` guarda o id do contato já criado: presença = já subiu. Sem
-- ele, a rodada diária recriaria o mesmo contato todo dia.
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "cpfCnpj" TEXT;
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "contatoErpId" TEXT;
