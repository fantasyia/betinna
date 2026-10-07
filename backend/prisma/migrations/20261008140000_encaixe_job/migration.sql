-- Encaixe automático (risco) da OP: fila de trabalhos pro agente local (GPU)
-- e os arquivos que ele devolve (imagem, .plt). Só CRIA — nada destrutivo.
DO $$ BEGIN
  CREATE TYPE "EncaixeStatus" AS ENUM ('PENDENTE', 'RODANDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "EncaixeJob" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "opId" TEXT NOT NULL,
  "modeloLinhaId" TEXT NOT NULL,
  "status" "EncaixeStatus" NOT NULL DEFAULT 'PENDENTE',
  "tempoMin" INTEGER NOT NULL,
  "entrada" JSONB NOT NULL,
  "progresso" JSONB,
  "resultado" JSONB,
  "erro" TEXT,
  "agente" TEXT,
  "usuarioId" TEXT,
  "pegoEm" TIMESTAMP(3),
  "concluidoEm" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncaixeJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EncaixeJob_empresaId_status_idx" ON "EncaixeJob"("empresaId", "status");
CREATE INDEX IF NOT EXISTS "EncaixeJob_opId_idx" ON "EncaixeJob"("opId");
DO $$ BEGIN
  ALTER TABLE "EncaixeJob" ADD CONSTRAINT "EncaixeJob_opId_fkey" FOREIGN KEY ("opId")
    REFERENCES "OrdemProducao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "EncaixeArquivo" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "tamanho" INTEGER NOT NULL,
  "conteudo" BYTEA NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncaixeArquivo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EncaixeArquivo_jobId_tipo_key" ON "EncaixeArquivo"("jobId", "tipo");
DO $$ BEGIN
  ALTER TABLE "EncaixeArquivo" ADD CONSTRAINT "EncaixeArquivo_jobId_fkey" FOREIGN KEY ("jobId")
    REFERENCES "EncaixeJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
