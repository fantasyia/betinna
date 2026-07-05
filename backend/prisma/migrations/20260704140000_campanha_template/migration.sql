-- Biblioteca de templates de campanha reutilizáveis por empresa.
CREATE TABLE "CampanhaTemplate" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "criadoPorId" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "canal" "CampanhaCanal" NOT NULL DEFAULT 'EMAIL',
    "assunto" TEXT,
    "mensagemWa" TEXT,
    "mensagemEmail" TEXT,
    "objetivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampanhaTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampanhaTemplate_empresaId_idx" ON "CampanhaTemplate"("empresaId");

ALTER TABLE "CampanhaTemplate" ADD CONSTRAINT "CampanhaTemplate_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampanhaTemplate" ADD CONSTRAINT "CampanhaTemplate_criadoPorId_fkey"
    FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
