-- MullerBotPersona: 1 persona por empresa (singleton via UNIQUE empresaId)

CREATE TABLE "MullerBotPersona" (
  "id"           TEXT NOT NULL,
  "empresaId"    TEXT NOT NULL,
  "nome"         TEXT NOT NULL DEFAULT 'MullerBot',
  "tomVoz"       TEXT NOT NULL DEFAULT 'PROFISSIONAL',
  "instrucoes"   TEXT,
  "exemplosJson" JSONB,
  "saudacao"     TEXT,
  "ativo"        BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MullerBotPersona_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MullerBotPersona_empresaId_key" ON "MullerBotPersona"("empresaId");

ALTER TABLE "MullerBotPersona" ADD CONSTRAINT "MullerBotPersona_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
