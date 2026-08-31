-- Gatilho de fluxo: o RASTREIO passou a existir.
--
-- O ciclo do pedido é ENVIADO_ERP → PAGO → EM_SEPARACAO → ENVIADO → ENTREGUE, e
-- o único evento que existia nesse caminho era o de ENTREGUE. Mas o código de
-- rastreio aparece no DESPACHO, dias antes — então um fluxo pendurado em
-- PEDIDO_ENTREGUE mandaria o código depois de a encomenda ter chegado na casa
-- da pessoa, que é o oposto de acompanhar a entrega.
ALTER TYPE "FluxoTriggerTipo" ADD VALUE IF NOT EXISTS 'PEDIDO_RASTREIO_DISPONIVEL';
