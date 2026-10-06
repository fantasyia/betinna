-- ERP próprio · Fase 3 — contas a pagar e a receber (sem NF-e) da Ribelt
-- Distribuidora Têxtil (card cmuvn3e0o01i2lr5itqyvsajh). Só CRIA e liga a flag
-- de UMA empresa: o container antigo não conhece nada disto.

-- CreateEnum
CREATE TYPE "FinTipo" AS ENUM ('RECEBER', 'PAGAR');

-- CreateEnum
CREATE TYPE "FinStatus" AS ENUM ('ABERTO', 'PARCIAL', 'QUITADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "FinCategoria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "FinTipo" NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinConta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "saldoInicial" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinConta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinTitulo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "FinTipo" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" "FinStatus" NOT NULL DEFAULT 'ABERTO',
    "categoriaId" TEXT,
    "contatoNome" TEXT,
    "clienteId" TEXT,
    "faccaoId" TEXT,
    "pedidoId" TEXT,
    "parcela" INTEGER,
    "totalParcelas" INTEGER,
    "opEntregaId" TEXT,
    "opSaldoId" TEXT,
    "insumoMovimentoId" TEXT,
    "recorrenciaId" TEXT,
    "observacoes" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinTitulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinBaixa" (
    "id" TEXT NOT NULL,
    "tituloId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "forma" TEXT,
    "observacao" TEXT,
    "usuarioId" TEXT,
    "estornadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinBaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinRecorrencia" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "FinTipo" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "dia" INTEGER NOT NULL,
    "categoriaId" TEXT,
    "contatoNome" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinRecorrencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinCategoria_empresaId_tipo_nome_key" ON "FinCategoria"("empresaId", "tipo", "nome");
CREATE UNIQUE INDEX "FinConta_empresaId_nome_key" ON "FinConta"("empresaId", "nome");
CREATE UNIQUE INDEX "FinTitulo_opEntregaId_key" ON "FinTitulo"("opEntregaId");
CREATE UNIQUE INDEX "FinTitulo_opSaldoId_key" ON "FinTitulo"("opSaldoId");
CREATE UNIQUE INDEX "FinTitulo_insumoMovimentoId_key" ON "FinTitulo"("insumoMovimentoId");
CREATE UNIQUE INDEX "FinTitulo_pedidoId_parcela_key" ON "FinTitulo"("pedidoId", "parcela");
CREATE UNIQUE INDEX "FinTitulo_recorrenciaId_vencimento_key" ON "FinTitulo"("recorrenciaId", "vencimento");
CREATE INDEX "FinTitulo_empresaId_tipo_status_vencimento_idx" ON "FinTitulo"("empresaId", "tipo", "status", "vencimento");
CREATE INDEX "FinTitulo_empresaId_vencimento_idx" ON "FinTitulo"("empresaId", "vencimento");
CREATE INDEX "FinBaixa_tituloId_idx" ON "FinBaixa"("tituloId");
CREATE INDEX "FinBaixa_contaId_data_idx" ON "FinBaixa"("contaId", "data");
CREATE INDEX "FinRecorrencia_empresaId_ativo_idx" ON "FinRecorrencia"("empresaId", "ativo");

-- AddForeignKey
ALTER TABLE "FinTitulo" ADD CONSTRAINT "FinTitulo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "FinCategoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinTitulo" ADD CONSTRAINT "FinTitulo_recorrenciaId_fkey" FOREIGN KEY ("recorrenciaId") REFERENCES "FinRecorrencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinBaixa" ADD CONSTRAINT "FinBaixa_tituloId_fkey" FOREIGN KEY ("tituloId") REFERENCES "FinTitulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinBaixa" ADD CONSTRAINT "FinBaixa_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "FinConta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinRecorrencia" ADD CONSTRAINT "FinRecorrencia_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "FinCategoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Liga o financeiro SÓ na Distribuidora. A chave `financeiro` não existe no
-- PATCH /empresas/config (o schema descarta), então nenhuma tela liga — só aqui.
UPDATE "Empresa"
SET "config" = jsonb_set(
  COALESCE("config", '{}'::jsonb),
  '{financeiro}',
  COALESCE("config"->'financeiro', '{}'::jsonb) || '{"ativo": true}'::jsonb,
  true
)
WHERE "id" = 'cmuvkzvt8019flr5ia249uv88';
