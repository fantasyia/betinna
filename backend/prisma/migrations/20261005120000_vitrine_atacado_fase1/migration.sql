-- Vitrine de atacado — Fase 1 (Ribelt Distribuidora Têxtil, 05/10/2026).
-- SÓ CRIA tabelas novas (Vitrine + Catalogo*): nenhuma tabela existente é alterada.
-- Empresa sem linha em "Vitrine" não lê nem escreve nada daqui.

-- CreateTable
CREATE TABLE "Vitrine" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "minimoEntrada" INTEGER,
    "minimoVolume" INTEGER,
    "minimoAtacadao" INTEGER DEFAULT 500,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vitrine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoCor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoCor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoLinha" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoLinha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoTamanho" (
    "id" TEXT NOT NULL,
    "linhaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogoTamanho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoModelo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT,
    "descricao" TEXT,
    "etiquetas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tituloMarketplace" VARCHAR(60),
    "descricaoMarketplace" TEXT,
    "composicao" VARCHAR(200),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoModelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoModeloCor" (
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "corId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogoModeloCor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoFoto" (
    "id" TEXT NOT NULL,
    "modeloCorId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbPath" TEXT,
    "largura" INTEGER,
    "altura" INTEGER,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogoFoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoModeloLinha" (
    "id" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "linhaId" TEXT NOT NULL,
    "precoEntrada" DECIMAL(14,2),
    "precoVolume" DECIMAL(14,2),
    "precoAtacadao" DECIMAL(14,2),
    "precoSugerido" DECIMAL(14,2),
    "tabelaMedidas" JSONB,

    CONSTRAINT "CatalogoModeloLinha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoModeloTamanho" (
    "id" TEXT NOT NULL,
    "modeloLinhaId" TEXT NOT NULL,
    "tamanhoId" TEXT NOT NULL,

    CONSTRAINT "CatalogoModeloTamanho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoVariacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "modeloCorId" TEXT NOT NULL,
    "modeloLinhaId" TEXT NOT NULL,
    "modeloTamanhoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "sku" TEXT,
    "estoque" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoVariacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vitrine_empresaId_key" ON "Vitrine"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Vitrine_slug_key" ON "Vitrine"("slug");

-- CreateIndex
CREATE INDEX "CatalogoCor_empresaId_ordem_idx" ON "CatalogoCor"("empresaId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoCor_empresaId_nome_key" ON "CatalogoCor"("empresaId", "nome");

-- CreateIndex
CREATE INDEX "CatalogoLinha_empresaId_ordem_idx" ON "CatalogoLinha"("empresaId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoLinha_empresaId_nome_key" ON "CatalogoLinha"("empresaId", "nome");

-- CreateIndex
CREATE INDEX "CatalogoTamanho_linhaId_ordem_idx" ON "CatalogoTamanho"("linhaId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoTamanho_linhaId_nome_key" ON "CatalogoTamanho"("linhaId", "nome");

-- CreateIndex
CREATE INDEX "CatalogoModelo_empresaId_ativo_ordem_idx" ON "CatalogoModelo"("empresaId", "ativo", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoModeloCor_modeloId_corId_key" ON "CatalogoModeloCor"("modeloId", "corId");

-- CreateIndex
CREATE INDEX "CatalogoFoto_modeloCorId_ordem_idx" ON "CatalogoFoto"("modeloCorId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoModeloLinha_modeloId_linhaId_key" ON "CatalogoModeloLinha"("modeloId", "linhaId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoModeloTamanho_modeloLinhaId_tamanhoId_key" ON "CatalogoModeloTamanho"("modeloLinhaId", "tamanhoId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoVariacao_produtoId_key" ON "CatalogoVariacao"("produtoId");

-- CreateIndex
CREATE INDEX "CatalogoVariacao_empresaId_modeloId_idx" ON "CatalogoVariacao"("empresaId", "modeloId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoVariacao_modeloCorId_modeloTamanhoId_key" ON "CatalogoVariacao"("modeloCorId", "modeloTamanhoId");

-- AddForeignKey
ALTER TABLE "Vitrine" ADD CONSTRAINT "Vitrine_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoCor" ADD CONSTRAINT "CatalogoCor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoLinha" ADD CONSTRAINT "CatalogoLinha_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoTamanho" ADD CONSTRAINT "CatalogoTamanho_linhaId_fkey" FOREIGN KEY ("linhaId") REFERENCES "CatalogoLinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoModelo" ADD CONSTRAINT "CatalogoModelo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoModeloCor" ADD CONSTRAINT "CatalogoModeloCor_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "CatalogoModelo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoModeloCor" ADD CONSTRAINT "CatalogoModeloCor_corId_fkey" FOREIGN KEY ("corId") REFERENCES "CatalogoCor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoFoto" ADD CONSTRAINT "CatalogoFoto_modeloCorId_fkey" FOREIGN KEY ("modeloCorId") REFERENCES "CatalogoModeloCor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoModeloLinha" ADD CONSTRAINT "CatalogoModeloLinha_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "CatalogoModelo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoModeloLinha" ADD CONSTRAINT "CatalogoModeloLinha_linhaId_fkey" FOREIGN KEY ("linhaId") REFERENCES "CatalogoLinha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoModeloTamanho" ADD CONSTRAINT "CatalogoModeloTamanho_modeloLinhaId_fkey" FOREIGN KEY ("modeloLinhaId") REFERENCES "CatalogoModeloLinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoModeloTamanho" ADD CONSTRAINT "CatalogoModeloTamanho_tamanhoId_fkey" FOREIGN KEY ("tamanhoId") REFERENCES "CatalogoTamanho"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoVariacao" ADD CONSTRAINT "CatalogoVariacao_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "CatalogoModelo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoVariacao" ADD CONSTRAINT "CatalogoVariacao_modeloCorId_fkey" FOREIGN KEY ("modeloCorId") REFERENCES "CatalogoModeloCor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoVariacao" ADD CONSTRAINT "CatalogoVariacao_modeloLinhaId_fkey" FOREIGN KEY ("modeloLinhaId") REFERENCES "CatalogoModeloLinha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoVariacao" ADD CONSTRAINT "CatalogoVariacao_modeloTamanhoId_fkey" FOREIGN KEY ("modeloTamanhoId") REFERENCES "CatalogoModeloTamanho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoVariacao" ADD CONSTRAINT "CatalogoVariacao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

