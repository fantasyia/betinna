-- Avaliações da Shopee na vitrine (25/10, card cmvleo3tv).
CREATE TABLE IF NOT EXISTS "AvaliacaoVitrine" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "modeloId" TEXT NOT NULL,
  "origem" VARCHAR(20) NOT NULL,
  "externoId" VARCHAR(60) NOT NULL,
  "estrelas" INTEGER NOT NULL,
  "texto" TEXT NOT NULL,
  "cores" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  "motivo" VARCHAR(200),
  "revisada" BOOLEAN NOT NULL DEFAULT false,
  "avaliadaEm" TIMESTAMP(3),
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvaliacaoVitrine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AvaliacaoVitrine_empresaId_origem_externoId_key" ON "AvaliacaoVitrine"("empresaId", "origem", "externoId");
CREATE INDEX IF NOT EXISTS "AvaliacaoVitrine_empresaId_modeloId_status_idx" ON "AvaliacaoVitrine"("empresaId", "modeloId", "status");
