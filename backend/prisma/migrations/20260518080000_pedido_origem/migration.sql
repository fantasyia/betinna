-- Pedido.pedidoOrigemId — quando pedido foi criado via "duplicar",
-- aponta pro original. SetNull preserva o histórico do duplicado se o
-- original for excluído (raro, mas defensivo).

ALTER TABLE "Pedido" ADD COLUMN "pedidoOrigemId" TEXT;

ALTER TABLE "Pedido"
  ADD CONSTRAINT "Pedido_pedidoOrigemId_fkey"
  FOREIGN KEY ("pedidoOrigemId") REFERENCES "Pedido"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Pedido_pedidoOrigemId_idx" ON "Pedido"("pedidoOrigemId");
