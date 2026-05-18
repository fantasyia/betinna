-- Funis customizados — modelo SimplesDesk:
-- Cada empresa pode criar múltiplos funis (Vendas B2B, Inbound, Reativação,
-- etc), com etapas próprias (nome, cor, ordem, tipo, probabilidade, SLA).

-- ─── Enum ─────────────────────────────────────────────────────────────
CREATE TYPE "FunilEtapaTipo" AS ENUM ('ATIVA', 'GANHO', 'PERDIDO');

-- ─── Tabelas ──────────────────────────────────────────────────────────
CREATE TABLE "Funil" (
  "id"           TEXT NOT NULL,
  "empresaId"    TEXT NOT NULL,
  "nome"         TEXT NOT NULL,
  "descricao"    TEXT,
  "cor"          TEXT NOT NULL DEFAULT '#201554',
  "ordem"        INTEGER NOT NULL DEFAULT 0,
  "ativo"        BOOLEAN NOT NULL DEFAULT true,
  "isPadrao"     BOOLEAN NOT NULL DEFAULT false,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Funil_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Funil_empresaId_nome_key" ON "Funil"("empresaId", "nome");
CREATE INDEX "Funil_empresaId_ativo_idx" ON "Funil"("empresaId", "ativo");

ALTER TABLE "Funil"
  ADD CONSTRAINT "Funil_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FunilEtapa" (
  "id"            TEXT NOT NULL,
  "funilId"       TEXT NOT NULL,
  "nome"          TEXT NOT NULL,
  "cor"           TEXT NOT NULL DEFAULT '#7c3aed',
  "ordem"         INTEGER NOT NULL DEFAULT 0,
  "tipo"          "FunilEtapaTipo" NOT NULL DEFAULT 'ATIVA',
  "probabilidade" INTEGER NOT NULL DEFAULT 50,
  "slaDias"       INTEGER,
  "criadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FunilEtapa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FunilEtapa_funilId_nome_key" ON "FunilEtapa"("funilId", "nome");
CREATE INDEX "FunilEtapa_funilId_ordem_idx" ON "FunilEtapa"("funilId", "ordem");

ALTER TABLE "FunilEtapa"
  ADD CONSTRAINT "FunilEtapa_funilId_fkey"
  FOREIGN KEY ("funilId") REFERENCES "Funil"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Lead: adiciona funilId + funilEtapaId ────────────────────────────
ALTER TABLE "Lead" ADD COLUMN "funilId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "funilEtapaId" TEXT;

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_funilId_fkey"
  FOREIGN KEY ("funilId") REFERENCES "Funil"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_funilEtapaId_fkey"
  FOREIGN KEY ("funilEtapaId") REFERENCES "FunilEtapa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Lead_empresaId_funilId_funilEtapaId_idx"
  ON "Lead"("empresaId", "funilId", "funilEtapaId");

-- ─── Data: cria "Funil Padrão" pra cada empresa + popula leads existentes
DO $$
DECLARE
  emp RECORD;
  funil_id TEXT;
  etapa_novo TEXT;
  etapa_qual TEXT;
  etapa_prop TEXT;
  etapa_nego TEXT;
  etapa_ganho TEXT;
  etapa_perd TEXT;
BEGIN
  FOR emp IN SELECT id FROM "Empresa" LOOP
    -- Cria o funil padrão
    funil_id := 'funil_' || substr(md5(random()::text || emp.id), 1, 24);
    INSERT INTO "Funil" ("id", "empresaId", "nome", "descricao", "cor", "isPadrao", "atualizadoEm")
    VALUES (
      funil_id,
      emp.id,
      'Funil Padrão',
      'Funil de vendas inicial — pode editar etapas, criar mais funis ou renomear.',
      '#201554',
      true,
      CURRENT_TIMESTAMP
    );

    -- Cria as 6 etapas (mantém ordem + cores do brandbook)
    etapa_novo  := 'fet_' || substr(md5(random()::text || 'novo'  || funil_id), 1, 24);
    etapa_qual  := 'fet_' || substr(md5(random()::text || 'qual'  || funil_id), 1, 24);
    etapa_prop  := 'fet_' || substr(md5(random()::text || 'prop'  || funil_id), 1, 24);
    etapa_nego  := 'fet_' || substr(md5(random()::text || 'nego'  || funil_id), 1, 24);
    etapa_ganho := 'fet_' || substr(md5(random()::text || 'ganho' || funil_id), 1, 24);
    etapa_perd  := 'fet_' || substr(md5(random()::text || 'perd'  || funil_id), 1, 24);

    INSERT INTO "FunilEtapa" ("id", "funilId", "nome", "cor", "ordem", "tipo", "probabilidade", "slaDias", "atualizadoEm") VALUES
      (etapa_novo,  funil_id, 'Novo',         '#5C88DA', 0, 'ATIVA',   10, 3,    CURRENT_TIMESTAMP),
      (etapa_qual,  funil_id, 'Qualificando', '#201554', 1, 'ATIVA',   25, 5,    CURRENT_TIMESTAMP),
      (etapa_prop,  funil_id, 'Proposta',     '#b07820', 2, 'ATIVA',   50, 7,    CURRENT_TIMESTAMP),
      (etapa_nego,  funil_id, 'Negociação',   '#bd1fbf', 3, 'ATIVA',   75, 10,   CURRENT_TIMESTAMP),
      (etapa_ganho, funil_id, 'Ganho',        '#2d8f5e', 4, 'GANHO',  100, NULL, CURRENT_TIMESTAMP),
      (etapa_perd,  funil_id, 'Perdido',      '#c43c3c', 5, 'PERDIDO', 0, NULL,  CURRENT_TIMESTAMP);

    -- Liga os leads existentes da empresa ao funil + etapa correspondente
    UPDATE "Lead" SET "funilId" = funil_id, "funilEtapaId" = etapa_novo
      WHERE "empresaId" = emp.id AND "etapa" = 'NOVO';
    UPDATE "Lead" SET "funilId" = funil_id, "funilEtapaId" = etapa_qual
      WHERE "empresaId" = emp.id AND "etapa" = 'QUALIFICANDO';
    UPDATE "Lead" SET "funilId" = funil_id, "funilEtapaId" = etapa_prop
      WHERE "empresaId" = emp.id AND "etapa" = 'PROPOSTA';
    UPDATE "Lead" SET "funilId" = funil_id, "funilEtapaId" = etapa_nego
      WHERE "empresaId" = emp.id AND "etapa" = 'NEGOCIACAO';
    UPDATE "Lead" SET "funilId" = funil_id, "funilEtapaId" = etapa_ganho
      WHERE "empresaId" = emp.id AND "etapa" = 'GANHO';
    UPDATE "Lead" SET "funilId" = funil_id, "funilEtapaId" = etapa_perd
      WHERE "empresaId" = emp.id AND "etapa" = 'PERDIDO';
  END LOOP;
END $$;
