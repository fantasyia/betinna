-- Web Push (aparelhos inscritos) e pendências de marketplace (24/10). Só ADD.
CREATE TABLE IF NOT EXISTS "PushInscricao" (
  "id" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "empresaId" TEXT,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" VARCHAR(300),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ultimoUsoEm" TIMESTAMP(3),
  CONSTRAINT "PushInscricao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushInscricao_endpoint_key" ON "PushInscricao"("endpoint");
CREATE INDEX IF NOT EXISTS "PushInscricao_usuarioId_idx" ON "PushInscricao"("usuarioId");

CREATE TABLE IF NOT EXISTS "PendenciaMarketplace" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "canal" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "titulo" VARCHAR(200) NOT NULL,
  "detalhe" VARCHAR(500),
  "link" VARCHAR(300),
  "desde" TIMESTAMP(3),
  "prazo" TIMESTAMP(3),
  "avisadaEm" TIMESTAMP(3),
  "lembreteEm" TIMESTAMP(3),
  "resolvidaEm" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendenciaMarketplace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PendenciaMarketplace_empresaId_canal_tipo_chave_key" ON "PendenciaMarketplace"("empresaId", "canal", "tipo", "chave");
CREATE INDEX IF NOT EXISTS "PendenciaMarketplace_empresaId_resolvidaEm_idx" ON "PendenciaMarketplace"("empresaId", "resolvidaEm");
