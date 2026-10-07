-- Gatilho de fluxo "pedido pago" (Léo, 07/10): dispara quando o pedido vira
-- PAGO — Asaas (Pix/cartão na vitrine), "Pagamento recebido" manual ou o
-- avanço de status ENVIADO_ERP → PAGO.
--
-- Só ADD VALUE: o container antigo (que ainda atende durante o deploy) não lê
-- nem escreve esse valor, então não há janela de erro.
ALTER TYPE "FluxoTriggerTipo" ADD VALUE IF NOT EXISTS 'PEDIDO_PAGO';
