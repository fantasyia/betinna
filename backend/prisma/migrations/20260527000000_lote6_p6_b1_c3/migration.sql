-- Lote 6 — P6 (solicitar cancelamento) + B1 (desconto à vista) + C3 (aceite externo)
-- Aprovado pelo usuário em 2026-05-27.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Enum novo — status da solicitação de cancelamento (P6.2)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TYPE "PedidoCancelamentoStatus" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA');

-- ───────────────────────────────────────────────────────────────────────────
-- 2) B1 — Desconto à vista configurável por empresa
--    Colunas opcionais com default 0 (= feature desligada) — não afeta empresas existentes.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "Empresa"
  ADD COLUMN "descontoPixPct"          DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN "descontoBoletoAvistaPct" DOUBLE PRECISION DEFAULT 0;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) C3 — Aceite externo do cliente via link público
--    Colunas opcionais — null por padrão; só preenchidas quando o rep enviar
--    pro cliente aprovar (gera aceiteToken JWT) e quando o cliente aceitar.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "Proposta"
  ADD COLUMN "aceiteToken"    TEXT,
  ADD COLUMN "aceiteExpiraEm" TIMESTAMP(3),
  ADD COLUMN "aceitoEm"       TIMESTAMP(3),
  ADD COLUMN "aceitoDoIp"     TEXT;

CREATE UNIQUE INDEX "Proposta_aceiteToken_key" ON "Proposta"("aceiteToken");

-- ───────────────────────────────────────────────────────────────────────────
-- 4) P6 — Tabela de solicitação de cancelamento de pedido
--    Rep/Gerente cria PENDENTE com motivo; Diretor/Admin aprova ou rejeita.
--    Aprovação dispara cancelamento real do pedido (status → CANCELADO).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE "PedidoCancelamentoSolicitacao" (
  "id"                TEXT NOT NULL,
  "pedidoId"          TEXT NOT NULL,
  "solicitanteId"     TEXT NOT NULL,
  "motivo"            TEXT NOT NULL,
  "status"            "PedidoCancelamentoStatus" NOT NULL DEFAULT 'PENDENTE',
  "decididoPorId"     TEXT,
  "decididoEm"        TIMESTAMP(3),
  "decisaoComentario" TEXT,
  "criadoEm"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PedidoCancelamentoSolicitacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PedidoCancelamentoSolicitacao_pedidoId_idx"
  ON "PedidoCancelamentoSolicitacao"("pedidoId");

CREATE INDEX "PedidoCancelamentoSolicitacao_status_criadoEm_idx"
  ON "PedidoCancelamentoSolicitacao"("status", "criadoEm");

ALTER TABLE "PedidoCancelamentoSolicitacao"
  ADD CONSTRAINT "PedidoCancelamentoSolicitacao_pedidoId_fkey"
    FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PedidoCancelamentoSolicitacao_solicitanteId_fkey"
    FOREIGN KEY ("solicitanteId") REFERENCES "Usuario"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PedidoCancelamentoSolicitacao_decididoPorId_fkey"
    FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
