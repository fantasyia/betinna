-- O ERP passou a ser o Tiny (Olist) — decisão do Léo em 26/08/2026. Os nomes
-- ficam NEUTROS (Erp), não trocam de marca: se o ERP mudar de novo, o schema não
-- precisa mudar junto.
--
-- É seguro fazer agora e caro depois: no momento desta migration as quatro
-- tabelas envolvidas têm ZERO linha com valor nessas colunas (o OMIE nunca saiu
-- do modo demo). RENAME é operação de catálogo, instantânea, sem reescrita.
--
-- Índices e constraints são renomeados JUNTO de propósito: o Postgres mantém o
-- nome antigo depois de um RENAME COLUMN, e o Prisma espera o nome derivado da
-- coluna nova — deixar assim criaria drift e o fallback `db push` do deploy
-- resolveria dropando/recriando índice em silêncio.

-- ─── Cliente ──────────────────────────────────────────────────────────
ALTER TABLE "Cliente" RENAME COLUMN "codigoOmie" TO "codigoErp";
ALTER TABLE "Cliente" RENAME COLUMN "omieStatus" TO "erpStatus";
ALTER INDEX "Cliente_empresaId_codigoOmie_key" RENAME TO "Cliente_empresaId_codigoErp_key";
ALTER INDEX "Cliente_omieStatus_idx" RENAME TO "Cliente_erpStatus_idx";
ALTER TABLE "Cliente" RENAME CONSTRAINT "Cliente_omieStatus_not_null" TO "Cliente_erpStatus_not_null";

-- ─── Produto ──────────────────────────────────────────────────────────
ALTER TABLE "Produto" RENAME COLUMN "codigoOmie" TO "codigoErp";
ALTER INDEX "Produto_empresaId_codigoOmie_key" RENAME TO "Produto_empresaId_codigoErp_key";

-- ─── Pedido ───────────────────────────────────────────────────────────
ALTER TABLE "Pedido" RENAME COLUMN "numeroOmie" TO "numeroErp";
ALTER TABLE "Pedido" RENAME COLUMN "enviadoOmieEm" TO "enviadoErpEm";
ALTER INDEX "Pedido_empresaId_numeroOmie_key" RENAME TO "Pedido_empresaId_numeroErp_key";

-- ─── Amostra ──────────────────────────────────────────────────────────
ALTER TABLE "Amostra" RENAME COLUMN "numeroOmie" TO "numeroErp";
ALTER TABLE "Amostra" RENAME COLUMN "enviadoOmieEm" TO "enviadoErpEm";

-- ─── Enums ────────────────────────────────────────────────────────────
-- O tipo array "_ClienteOmieStatus" é renomeado pelo Postgres automaticamente.
ALTER TYPE "ClienteOmieStatus" RENAME TO "ClienteErpStatus";
ALTER TYPE "PedidoStatus" RENAME VALUE 'ENVIADO_OMIE' TO 'ENVIADO_ERP';
-- PedidoOrigem.OMIE nunca foi usado por código nenhum (grep limpo) nem por
-- linha nenhuma — vira ERP junto, pra não sobrar marca de ERP no schema.
ALTER TYPE "PedidoOrigem" RENAME VALUE 'OMIE' TO 'ERP';
