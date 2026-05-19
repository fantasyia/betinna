-- Migration: add_is_demo_flag
-- Data: 2026-05-18
-- Adiciona flag `isDemo` em 8 modelos pra permitir seed-demo e cleanup
-- seletivo via /admin/seed-demo. Tudo aditivo (default false) — não toca
-- dados existentes. Inclui índices compostos pra wipe rápido.

-- ─── Cliente ─────────────────────────────────────────────────────────────
ALTER TABLE "Cliente" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Cliente_empresaId_isDemo_idx" ON "Cliente"("empresaId", "isDemo");

-- ─── Produto ─────────────────────────────────────────────────────────────
ALTER TABLE "Produto" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Produto_empresaId_isDemo_idx" ON "Produto"("empresaId", "isDemo");

-- ─── Pedido ──────────────────────────────────────────────────────────────
ALTER TABLE "Pedido" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Pedido_empresaId_isDemo_idx" ON "Pedido"("empresaId", "isDemo");

-- ─── Proposta ────────────────────────────────────────────────────────────
ALTER TABLE "Proposta" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Proposta_empresaId_isDemo_idx" ON "Proposta"("empresaId", "isDemo");

-- ─── Amostra ─────────────────────────────────────────────────────────────
ALTER TABLE "Amostra" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Amostra_empresaId_isDemo_idx" ON "Amostra"("empresaId", "isDemo");

-- ─── Comissao ────────────────────────────────────────────────────────────
ALTER TABLE "Comissao" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Comissao_empresaId_isDemo_idx" ON "Comissao"("empresaId", "isDemo");

-- ─── Conversation ────────────────────────────────────────────────────────
ALTER TABLE "Conversation" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Conversation_empresaId_isDemo_idx" ON "Conversation"("empresaId", "isDemo");

-- ─── RespostaNPS (sem empresaId direto, só via pesquisaId) ──────────────
ALTER TABLE "RespostaNPS" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "RespostaNPS_isDemo_idx" ON "RespostaNPS"("isDemo");
