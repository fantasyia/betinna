-- Chave de API própria pro checkout do site criar PEDIDO (POST /public/pedidos).
-- Até 29/09/2026 a rota aceitava a mesma chave dos formulários de lead; separar
-- limita o estrago de um vazamento: a de leads cria lead, esta cria pedido no ERP.
-- 1 chave por empresa; só o SHA-256 fica no banco (chave em claro mostrada 1x).
CREATE TABLE "PedidoSiteChave" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "chaveHash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3),

    CONSTRAINT "PedidoSiteChave_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PedidoSiteChave_empresaId_key" ON "PedidoSiteChave"("empresaId");

CREATE UNIQUE INDEX "PedidoSiteChave_chaveHash_key" ON "PedidoSiteChave"("chaveHash");

ALTER TABLE "PedidoSiteChave" ADD CONSTRAINT "PedidoSiteChave_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
