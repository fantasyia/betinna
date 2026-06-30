-- Documentos da base de conhecimento (PDF/DOCX/TXT) + vínculo dos chunks extraídos.

-- AlterTable: agrupa os trechos extraídos de um mesmo arquivo.
ALTER TABLE "KnowledgeChunk" ADD COLUMN "documentoId" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeDocumento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL DEFAULT 0,
    "podeEnviar" BOOLEAN NOT NULL DEFAULT false,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "erroExtracao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDocumento_empresaId_criadoEm_idx" ON "KnowledgeDocumento"("empresaId", "criadoEm");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_documentoId_idx" ON "KnowledgeChunk"("documentoId");

-- AddForeignKey
ALTER TABLE "KnowledgeDocumento" ADD CONSTRAINT "KnowledgeDocumento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "KnowledgeDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
