-- Metas + Segmentos

CREATE TABLE "Meta" (
  "id"            TEXT NOT NULL,
  "empresaId"     TEXT NOT NULL,
  "titulo"        TEXT NOT NULL,
  "descricao"     TEXT,
  "tipo"          TEXT NOT NULL DEFAULT 'FATURAMENTO',
  "valorAlvo"     DECIMAL(14,2) NOT NULL,
  "alvoTipo"      TEXT NOT NULL DEFAULT 'REP',
  "alvoId"        TEXT,
  "periodicidade" TEXT NOT NULL DEFAULT 'MES',
  "inicio"        TIMESTAMP(3) NOT NULL,
  "fim"           TIMESTAMP(3) NOT NULL,
  "ativo"         BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Meta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Meta_empresaId_ativo_idx" ON "Meta"("empresaId", "ativo");
CREATE INDEX "Meta_empresaId_alvoTipo_alvoId_idx" ON "Meta"("empresaId", "alvoTipo", "alvoId");

ALTER TABLE "Meta" ADD CONSTRAINT "Meta_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Segmento" (
  "id"           TEXT NOT NULL,
  "empresaId"    TEXT NOT NULL,
  "nome"         TEXT NOT NULL,
  "descricao"    TEXT,
  "regrasJson"   JSONB NOT NULL,
  "cor"          TEXT DEFAULT '#facc15',
  "ativo"        BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Segmento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Segmento_empresaId_nome_key" ON "Segmento"("empresaId", "nome");
CREATE INDEX "Segmento_empresaId_ativo_idx" ON "Segmento"("empresaId", "ativo");

ALTER TABLE "Segmento" ADD CONSTRAINT "Segmento_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
