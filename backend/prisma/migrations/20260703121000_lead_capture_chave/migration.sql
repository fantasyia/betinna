-- Chave de API pública pra captura de leads (formulários do site do tenant).
-- 1 chave por empresa; só o SHA-256 fica no banco (chave em claro mostrada 1x).
CREATE TABLE "LeadCaptureChave" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "chaveHash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoEm" TIMESTAMP(3),

    CONSTRAINT "LeadCaptureChave_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadCaptureChave_empresaId_key" ON "LeadCaptureChave"("empresaId");

CREATE UNIQUE INDEX "LeadCaptureChave_chaveHash_key" ON "LeadCaptureChave"("chaveHash");

ALTER TABLE "LeadCaptureChave" ADD CONSTRAINT "LeadCaptureChave_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
