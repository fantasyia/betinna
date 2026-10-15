-- Recuperador de carrinho (Léo, 14/10 — card cmv8ikbin0011pt5ie51wvco8).
-- Carrinho salvo no servidor (pedido não pago, ou carrinho de quem veio pelo
-- link do WhatsApp com ?r=) + 2 gatilhos de fluxo. Só ADD: tabela nova e
-- valores novos no enum — o container antigo não lê nem escreve nada disso.
ALTER TYPE "FluxoTriggerTipo" ADD VALUE IF NOT EXISTS 'PEDIDO_NAO_PAGO';
ALTER TYPE "FluxoTriggerTipo" ADD VALUE IF NOT EXISTS 'CARRINHO_ABANDONADO';

CREATE TABLE IF NOT EXISTS "CarrinhoSalvo" (
  "id"           TEXT PRIMARY KEY,
  "empresaId"    TEXT NOT NULL,
  "vitrineId"    TEXT NOT NULL,
  "token"        TEXT NOT NULL,
  "origem"       TEXT NOT NULL,
  "pedidoId"     TEXT,
  "leadId"       TEXT,
  "itens"        JSONB NOT NULL,
  "contato"      JSONB,
  "frete"        JSONB,
  "notificadoEm" TIMESTAMP(3),
  "convertidoEm" TIMESTAMP(3),
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CarrinhoSalvo_token_key" ON "CarrinhoSalvo"("token");
CREATE INDEX IF NOT EXISTS "CarrinhoSalvo_origem_notificadoEm_atualizadoEm_idx" ON "CarrinhoSalvo"("origem", "notificadoEm", "atualizadoEm");
CREATE INDEX IF NOT EXISTS "CarrinhoSalvo_vitrineId_leadId_idx" ON "CarrinhoSalvo"("vitrineId", "leadId");
CREATE INDEX IF NOT EXISTS "CarrinhoSalvo_pedidoId_idx" ON "CarrinhoSalvo"("pedidoId");
