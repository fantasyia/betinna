-- Ponte site ↔ Betinna: o pedido do checkout entra aqui e volta pro site.
--
-- `numeroSite` é o número que o CLIENTE vê (SB1234). É por ele que o app avisa
-- o site quando a situação ou o rastreio mudam — sem guardar, o retorno não tem
-- como casar com o pedido de lá.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "numeroSite" TEXT;
CREATE INDEX IF NOT EXISTS "Pedido_empresaId_numeroSite_idx" ON "Pedido"("empresaId", "numeroSite");

-- Origem própria pro checkout: sem ela o pedido do site entraria como ERP e a
-- comissão de originação pagaria a % de representante em vez da de canal.
ALTER TYPE "PedidoOrigem" ADD VALUE IF NOT EXISTS 'SITE';
