-- Pedido: o que o SITE já sabe, e por que pode estar atrasado.
--
-- Sem isto, o aviso pro site dependia de `mudou` no sync do ERP — que compara o
-- ERP com o NOSSO banco. Como o push sai DEPOIS de gravar o banco, um push que
-- falhava nunca mais era tentado: na rodada seguinte ERP == banco, o sync
-- curto-circuitava em `semMudanca`, e o site ficava com o status velho pra
-- sempre. `siteErroEm` é o que a varredura de reenvio procura.

ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "siteStatusEnviado" TEXT;
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "siteRastreioEnviado" TEXT;
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "siteErro" TEXT;
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "siteErroEm" TIMESTAMP(3);

-- A varredura roda de minuto em minuto e filtra por (empresaId, siteErroEm).
CREATE INDEX IF NOT EXISTS "Pedido_empresaId_siteErroEm_idx"
  ON "Pedido" ("empresaId", "siteErroEm");
