-- Comissão por FASE (o rep vê em que pé está) e LOCAÇÃO comissionando POR MÊS.
--
-- Decisões do Léo (05/09/2026):
--  1. Venda = comissão ÚNICA por pedido. Locação = comissão por MÊS, atrelada ao
--     recebimento da mensalidade — não à instalação nem ao vencimento.
--  2. O rep enxerga a fase de cada linha: aguardando envio → a pagar em 05/MM →
--     paga → cancelada.

-- `Pedido.modalidade`: sem isto o pedido de locação era comissionado como venda
-- (uma linha sobre o total, na instalação). O aceite da proposta grava a
-- modalidade dela; pedido antigo e pedido do site continuam VENDA.
ALTER TABLE "Pedido"
  ADD COLUMN IF NOT EXISTS "modalidade" "PropostaModalidade" NOT NULL DEFAULT 'VENDA';

-- Quando o financeiro BAIXOU a conta a pagar no ERP. É o que separa
-- "a pagar em 05/MM" de "paga" na tela do rep.
ALTER TABLE "PedidoComissao"
  ADD COLUMN IF NOT EXISTS "pagoEm" TIMESTAMP(3);

-- Comissão de LOCAÇÃO: uma linha por contrato × pessoa × MÊS de competência.
-- Não cabia em PedidoComissao: lá a chave é o pedido, e aqui a mesma venda paga
-- todo mês enquanto o contrato viver.
CREATE TABLE "ContratoComissao" (
  "id"          TEXT NOT NULL,
  "empresaId"   TEXT NOT NULL,
  "contratoId"  TEXT NOT NULL,
  "usuarioId"   TEXT NOT NULL,
  "tipo"        "ComissaoTipo" NOT NULL,
  -- Mês da mensalidade (sempre dia 1, UTC).
  "competencia" TIMESTAMP(3) NOT NULL,
  "percentual"  DOUBLE PRECISION NOT NULL,
  "base"        DECIMAL(14,2) NOT NULL,
  "valor"       DECIMAL(14,2) NOT NULL,
  -- Preenchido quando a mensalidade DAQUELE mês foi recebida do cliente — é o
  -- gatilho da comissão de locação (não a instalação, não o vencimento).
  "mensalidadeRecebidaEm" TIMESTAMP(3),
  "contaPagarErpId" TEXT,
  "contaPagarValor" DECIMAL(14,2),
  "pagoEm"      TIMESTAMP(3),
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContratoComissao_pkey" PRIMARY KEY ("id")
);

-- Recalcular não duplica: uma linha por (contrato, pessoa, tipo, competência).
CREATE UNIQUE INDEX "ContratoComissao_contratoId_usuarioId_tipo_competencia_key"
  ON "ContratoComissao"("contratoId", "usuarioId", "tipo", "competencia");
CREATE INDEX "ContratoComissao_empresaId_competencia_idx"
  ON "ContratoComissao"("empresaId", "competencia");
CREATE INDEX "ContratoComissao_usuarioId_idx" ON "ContratoComissao"("usuarioId");

ALTER TABLE "ContratoComissao"
  ADD CONSTRAINT "ContratoComissao_empresaId_fkey" FOREIGN KEY ("empresaId")
  REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContratoComissao"
  ADD CONSTRAINT "ContratoComissao_contratoId_fkey" FOREIGN KEY ("contratoId")
  REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContratoComissao"
  ADD CONSTRAINT "ContratoComissao_usuarioId_fkey" FOREIGN KEY ("usuarioId")
  REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
