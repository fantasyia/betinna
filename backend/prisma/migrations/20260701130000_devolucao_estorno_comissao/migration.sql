-- Estorno proporcional de comissão na devolução APROVADA (líquido no mês do pedido).

-- Acumuladores no Pedido (o fecharMes desconta destes; nunca mexe em folha paga).
ALTER TABLE "Pedido" ADD COLUMN "comissaoEstornada" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Pedido" ADD COLUMN "valorDevolvido" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Valor devolvido da devolução (base do estorno; null = devolução total).
ALTER TABLE "Devolucao" ADD COLUMN "valorDevolvido" DECIMAL(14,2);
