-- Vínculo da comissão com a conta a pagar criada no ERP.
--
-- A comissão vira CONTA A PAGAR no Tiny (o ERP tem um vendedor por pedido e não
-- expõe comissão na API — é campo de painel). Guardar o id é o que impede
-- provisionar a mesma folha duas vezes: sem ele, um re-run do fechamento
-- duplicaria o pagamento, e dinheiro duplicado só aparece na conciliação.
ALTER TABLE "Comissao" ADD COLUMN IF NOT EXISTS "contaPagarErpId" TEXT;
