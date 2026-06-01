-- Sprint 2.3 — Respostas rápidas / templates pra a Inbox. 100% aditivo.

-- CreateTable
CREATE TABLE "RespostaRapida" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "atalho" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "categoria" TEXT,
    "global" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RespostaRapida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RespostaRapida_empresaId_idx" ON "RespostaRapida"("empresaId");
CREATE INDEX "RespostaRapida_criadoPorId_idx" ON "RespostaRapida"("criadoPorId");
