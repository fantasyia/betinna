-- RAG semântico — habilita pgvector + colunas de embedding no catálogo e na
-- base de conhecimento. Additivo (só CREATE/ADD): seguro pra deploy.

-- Extensão pgvector (Supabase já disponibiliza; idempotente).
CREATE EXTENSION IF NOT EXISTS vector;

-- Enum da origem do chunk de conhecimento.
DO $$ BEGIN
  CREATE TYPE "KnowledgeFonte" AS ENUM ('MANUAL', 'CONFIG', 'MATERIAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Embedding do catálogo (1536 dims = OpenAI text-embedding-3-small).
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "embeddingAtualizadoEm" TIMESTAMP(3);
ALTER TABLE "Produto" ADD COLUMN IF NOT EXISTS "embeddingTextoHash" TEXT;

-- Base de conhecimento geral da empresa.
CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fonte" "KnowledgeFonte" NOT NULL DEFAULT 'MANUAL',
    "categoria" TEXT,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "refId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "embedding" vector(1536),
    "embeddingAtualizadoEm" TIMESTAMP(3),
    "embeddingTextoHash" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeChunk_empresaId_fonte_refId_key"
    ON "KnowledgeChunk"("empresaId", "fonte", "refId");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_empresaId_ativo_idx"
    ON "KnowledgeChunk"("empresaId", "ativo");

ALTER TABLE "KnowledgeChunk"
    ADD CONSTRAINT "KnowledgeChunk_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índices HNSW (cosine) pra busca por similaridade. NULLs são ignorados pelo
-- índice, então o backfill incremental não atrapalha.
CREATE INDEX IF NOT EXISTS "Produto_embedding_hnsw_idx"
    ON "Produto" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw_idx"
    ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);
