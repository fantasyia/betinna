-- CreateTable
CREATE TABLE "EvolutionInstancia" (
    "id" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "ownerJid" TEXT,
    "connectionStatus" TEXT NOT NULL DEFAULT 'close',
    "ultimoEventoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionInstancia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvolutionInstancia_instanceName_key" ON "EvolutionInstancia"("instanceName");

-- CreateIndex
CREATE INDEX "EvolutionInstancia_empresaId_idx" ON "EvolutionInstancia"("empresaId");

-- CreateIndex
CREATE INDEX "EvolutionInstancia_connectionStatus_idx" ON "EvolutionInstancia"("connectionStatus");

-- AddForeignKey
ALTER TABLE "EvolutionInstancia" ADD CONSTRAINT "EvolutionInstancia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvolutionInstancia" ADD CONSTRAINT "EvolutionInstancia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
