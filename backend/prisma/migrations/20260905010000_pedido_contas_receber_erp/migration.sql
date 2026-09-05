-- Contas a receber que o app lançou no ERP ao faturar o pedido.
-- O Tiny só gera contas a receber a partir de parcelas, e o pedido que sobe
-- daqui não leva parcela — então o app lança e guarda os ids aqui.
ALTER TABLE "Pedido" ADD COLUMN IF NOT EXISTS "contasReceberErp" JSONB;
