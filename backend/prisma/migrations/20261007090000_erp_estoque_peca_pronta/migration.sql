-- ERP próprio · Fase 2 · entrega 1 — estoque de peça pronta (Ribelt Distribuidora Têxtil,
-- card cmuvn3dd501hrlr5imhgubopx).
--
-- Só CRIA (tipos, tabelas, índices) e liga a flag de UMA empresa: o container
-- antigo, que ainda atende durante o deploy, não conhece nada disto.

-- CreateEnum
CREATE TYPE "EstoqueMovTipo" AS ENUM ('ENTRADA_PRODUCAO', 'SAIDA_PEDIDO', 'AJUSTE', 'DEVOLUCAO');

-- CreateEnum
CREATE TYPE "EstoqueReservaStatus" AS ENUM ('ATIVA', 'CONFIRMADA', 'BAIXADA', 'LIBERADA');

-- CreateTable
CREATE TABLE "EstoqueMovimento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" "EstoqueMovTipo" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "motivo" TEXT,
    "pedidoId" TEXT,
    "documento" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstoqueMovimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstoqueReserva" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "status" "EstoqueReservaStatus" NOT NULL DEFAULT 'ATIVA',
    "expiraEm" TIMESTAMP(3),
    "motivoLiberacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueReserva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstoqueMovimento_empresaId_produtoId_idx" ON "EstoqueMovimento"("empresaId", "produtoId");
CREATE INDEX "EstoqueMovimento_empresaId_criadoEm_idx" ON "EstoqueMovimento"("empresaId", "criadoEm");
CREATE INDEX "EstoqueMovimento_pedidoId_idx" ON "EstoqueMovimento"("pedidoId");
CREATE INDEX "EstoqueReserva_empresaId_produtoId_status_idx" ON "EstoqueReserva"("empresaId", "produtoId", "status");
CREATE INDEX "EstoqueReserva_pedidoId_idx" ON "EstoqueReserva"("pedidoId");
CREATE INDEX "EstoqueReserva_status_expiraEm_idx" ON "EstoqueReserva"("status", "expiraEm");

-- AddForeignKey
ALTER TABLE "EstoqueMovimento" ADD CONSTRAINT "EstoqueMovimento_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EstoqueMovimento" ADD CONSTRAINT "EstoqueMovimento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EstoqueReserva" ADD CONSTRAINT "EstoqueReserva_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EstoqueReserva" ADD CONSTRAINT "EstoqueReserva_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Liga o ERP próprio SÓ na Distribuidora. A chave `erpInterno` não existe no
-- PATCH /empresas/config (o schema descarta), então nenhuma tela liga — só aqui.
UPDATE "Empresa"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{erpInterno}',
  COALESCE("config"->'erpInterno', '{}'::jsonb) || '{"ativo": true}'::jsonb,
  true
)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88';
