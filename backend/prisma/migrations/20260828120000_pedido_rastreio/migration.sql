-- Rastreio do pedido, espelhado do ERP.
--
-- Quem despacha é o Tiny (etiqueta do Melhor Envio sai de lá), então o código e
-- a URL de rastreamento nascem no ERP e só descem pra cá. Guardar no pedido é o
-- que permite o app — e depois o site — responderem "onde está" sem ninguém
-- abrir o ERP.
--
-- NULLABLE: pedido sem despacho ainda não tem rastreio, e isso é normal.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "rastreioCodigo" TEXT;
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "rastreioUrl" TEXT;
