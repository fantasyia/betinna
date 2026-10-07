-- Checkout Asaas (entrega 2): cobrança online do pedido da vitrine. Só cria
-- tabela — nada destrutivo.
CREATE TABLE IF NOT EXISTS "PedidoPagamento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "valorPedido" DECIMAL(14,2) NOT NULL,
    "valorCobrado" DECIMAL(14,2) NOT NULL,
    "asaasCobrancaId" TEXT NOT NULL,
    "asaasParcelamentoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "invoiceUrl" TEXT,
    "pagoEm" TIMESTAMP(3),
    "valorLiquido" DECIMAL(14,2),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PedidoPagamento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PedidoPagamento_asaasCobrancaId_key" ON "PedidoPagamento"("asaasCobrancaId");
CREATE INDEX IF NOT EXISTS "PedidoPagamento_pedidoId_criadoEm_idx" ON "PedidoPagamento"("pedidoId", "criadoEm");
CREATE INDEX IF NOT EXISTS "PedidoPagamento_asaasParcelamentoId_idx" ON "PedidoPagamento"("asaasParcelamentoId");
