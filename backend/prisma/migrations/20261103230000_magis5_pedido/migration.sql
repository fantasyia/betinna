-- Espelho dos pedidos do Magis5 (Fase 1, 03/11). Tabela nova: só leitura da API.
CREATE TABLE "Magis5Pedido" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "canal" TEXT,
    "status" TEXT,
    "pedidoEm" TIMESTAMP(3),
    "dados" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Magis5Pedido_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Magis5Pedido_empresaId_numero_key" ON "Magis5Pedido"("empresaId", "numero");
CREATE INDEX "Magis5Pedido_empresaId_pedidoEm_idx" ON "Magis5Pedido"("empresaId", "pedidoEm");

ALTER TABLE "Magis5Pedido" ADD CONSTRAINT "Magis5Pedido_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
