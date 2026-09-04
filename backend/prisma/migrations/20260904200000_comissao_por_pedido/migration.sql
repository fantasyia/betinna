-- Comissão POR PEDIDO e POR PESSOA.
--
-- Antes: `Pedido.comissao` era um campo só, do representante, e a venda de
-- canal tinha UM beneficiário pra empresa inteira (Empresa.config). Agora a %
-- é do usuário (rep e site) e cada pedido guarda uma linha por beneficiário —
-- é o que deixa abrir a folha e ver de quais vendas ela veio.

ALTER TYPE "ComissaoTipo" ADD VALUE IF NOT EXISTS 'SITE';

ALTER TABLE "Usuario"
  ADD COLUMN IF NOT EXISTS "comissaoSite" DOUBLE PRECISION DEFAULT 0;

-- Novo default do REP: 10%. Quem já tem valor configurado não é tocado.
ALTER TABLE "Usuario" ALTER COLUMN "comissaoPadrao" SET DEFAULT 10;

CREATE TABLE "PedidoComissao" (
  "id"         TEXT NOT NULL,
  "empresaId"  TEXT NOT NULL,
  "pedidoId"   TEXT NOT NULL,
  "usuarioId"  TEXT NOT NULL,
  "tipo"       "ComissaoTipo" NOT NULL,
  "percentual" DOUBLE PRECISION NOT NULL,
  "base"       DECIMAL(14,2) NOT NULL,
  "valor"      DECIMAL(14,2) NOT NULL,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PedidoComissao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PedidoComissao_pedidoId_usuarioId_tipo_key"
  ON "PedidoComissao"("pedidoId", "usuarioId", "tipo");
CREATE INDEX "PedidoComissao_empresaId_criadoEm_idx" ON "PedidoComissao"("empresaId", "criadoEm");
CREATE INDEX "PedidoComissao_usuarioId_idx" ON "PedidoComissao"("usuarioId");

ALTER TABLE "PedidoComissao"
  ADD CONSTRAINT "PedidoComissao_empresaId_fkey" FOREIGN KEY ("empresaId")
  REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PedidoComissao"
  ADD CONSTRAINT "PedidoComissao_pedidoId_fkey" FOREIGN KEY ("pedidoId")
  REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PedidoComissao"
  ADD CONSTRAINT "PedidoComissao_usuarioId_fkey" FOREIGN KEY ("usuarioId")
  REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
