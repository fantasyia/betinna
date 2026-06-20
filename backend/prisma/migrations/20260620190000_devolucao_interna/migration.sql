-- Devolução interna do pedido do rep (distinta de MarketplaceIncident).
CREATE TYPE "DevolucaoStatus" AS ENUM (
  'ABERTA', 'EM_ANALISE', 'APROVADA', 'NF_DEVOLUCAO_EMITIDA',
  'COLETA_AGENDADA', 'COLETADA', 'RESOLVIDA', 'RECUSADA'
);

CREATE TABLE "Devolucao" (
  "id" TEXT NOT NULL,
  "numero" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "pedidoId" TEXT NOT NULL,
  "clienteId" TEXT,
  "motivo" TEXT NOT NULL,
  "status" "DevolucaoStatus" NOT NULL DEFAULT 'ABERTA',
  "itensDescricao" TEXT,
  "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "observacao" TEXT,
  "slaAnaliseEm" TIMESTAMP(3),
  "aprovadorId" TEXT,
  "aprovadorNome" TEXT,
  "decididoEm" TIMESTAMP(3),
  "motivoRecusa" TEXT,
  "criadoPorId" TEXT,
  "criadoPorNome" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Devolucao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Devolucao_empresaId_numero_key" ON "Devolucao"("empresaId", "numero");
CREATE INDEX "Devolucao_empresaId_status_idx" ON "Devolucao"("empresaId", "status");
CREATE INDEX "Devolucao_pedidoId_idx" ON "Devolucao"("pedidoId");

ALTER TABLE "Devolucao"
  ADD CONSTRAINT "Devolucao_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Base da janela de devolução pós-entrega.
ALTER TABLE "Pedido" ADD COLUMN "entregueEm" TIMESTAMP(3);
