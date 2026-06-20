-- Materiais de venda: biblioteca de marketing da empresa (metadado; arquivo no Storage).
CREATE TABLE "MaterialVenda" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "descricao" TEXT,
  "produtoId" TEXT,
  "categoria" TEXT,
  "arquivoPath" TEXT NOT NULL,
  "arquivoNome" TEXT NOT NULL,
  "mimeType" TEXT,
  "tamanho" INTEGER,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "confidencial" BOOLEAN NOT NULL DEFAULT false,
  "criadoPorId" TEXT,
  "criadoPorNome" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialVenda_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialVenda_empresaId_tipo_idx" ON "MaterialVenda"("empresaId", "tipo");

ALTER TABLE "MaterialVenda"
  ADD CONSTRAINT "MaterialVenda_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
