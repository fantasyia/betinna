-- Inbox interna (rep ↔ empresa/diretor), distinta de Conversation (cliente-facing).
CREATE TYPE "InternalThreadStatus" AS ENUM ('ABERTA', 'RESPONDIDA', 'RESOLVIDA');

CREATE TABLE "InternalThread" (
  "id" TEXT NOT NULL,
  "numero" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "assunto" TEXT NOT NULL,
  "status" "InternalThreadStatus" NOT NULL DEFAULT 'ABERTA',
  "prioridade" TEXT NOT NULL DEFAULT 'media',
  "criadoPorId" TEXT,
  "criadoPorNome" TEXT,
  "pedidoId" TEXT,
  "clienteId" TEXT,
  "slaRespostaEm" TIMESTAMP(3),
  "ultimaMsgEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InternalThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalThread_empresaId_numero_key" ON "InternalThread"("empresaId", "numero");
CREATE INDEX "InternalThread_empresaId_status_idx" ON "InternalThread"("empresaId", "status");
CREATE INDEX "InternalThread_empresaId_criadoPorId_idx" ON "InternalThread"("empresaId", "criadoPorId");

CREATE TABLE "InternalMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "autorId" TEXT,
  "autorNome" TEXT NOT NULL,
  "ladoEmpresa" BOOLEAN NOT NULL DEFAULT false,
  "texto" TEXT NOT NULL,
  "isSistema" BOOLEAN NOT NULL DEFAULT false,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalMessage_threadId_idx" ON "InternalMessage"("threadId");

ALTER TABLE "InternalThread"
  ADD CONSTRAINT "InternalThread_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InternalMessage"
  ADD CONSTRAINT "InternalMessage_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "InternalThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
