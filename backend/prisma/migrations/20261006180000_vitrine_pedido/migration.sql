-- Vitrine de atacado, entrega 4: o pedido que o cliente envia pelo link entra
-- no Betinna com origem própria e acende um gatilho de fluxo.
--
-- Só ADD VALUE: o container antigo (que ainda atende durante o deploy) não lê
-- nem escreve esses valores, então não há janela de erro.
ALTER TYPE "PedidoOrigem" ADD VALUE IF NOT EXISTS 'VITRINE';
ALTER TYPE "FluxoTriggerTipo" ADD VALUE IF NOT EXISTS 'PEDIDO_CRIADO';
