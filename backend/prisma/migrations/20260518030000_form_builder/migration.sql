-- Form Builder: Formulario + FormularioCampo + FormularioResposta

CREATE TABLE "Formulario" (
  "id"                 TEXT NOT NULL,
  "empresaId"          TEXT NOT NULL,
  "slug"               TEXT NOT NULL,
  "titulo"             TEXT NOT NULL,
  "descricao"          TEXT,
  "mensagemSucesso"    TEXT,
  "redirectUrl"        TEXT,
  "geraLead"           BOOLEAN NOT NULL DEFAULT true,
  "leadEtapaInicial"   TEXT DEFAULT 'NOVO',
  "notificarUsuarioIds" JSONB,
  "ativo"              BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Formulario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Formulario_slug_key" ON "Formulario"("slug");
CREATE INDEX "Formulario_empresaId_ativo_idx" ON "Formulario"("empresaId", "ativo");

ALTER TABLE "Formulario" ADD CONSTRAINT "Formulario_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FormularioCampo" (
  "id"           TEXT NOT NULL,
  "formularioId" TEXT NOT NULL,
  "ordem"        INTEGER NOT NULL,
  "tipo"         TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "campo"        TEXT NOT NULL,
  "placeholder"  TEXT,
  "obrigatorio"  BOOLEAN NOT NULL DEFAULT false,
  "opcoes"       JSONB,
  "validacao"    JSONB,
  "hint"         TEXT,

  CONSTRAINT "FormularioCampo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormularioCampo_formularioId_ordem_idx"
  ON "FormularioCampo"("formularioId", "ordem");

ALTER TABLE "FormularioCampo" ADD CONSTRAINT "FormularioCampo_formularioId_fkey"
  FOREIGN KEY ("formularioId") REFERENCES "Formulario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FormularioResposta" (
  "id"           TEXT NOT NULL,
  "formularioId" TEXT NOT NULL,
  "dados"        JSONB NOT NULL,
  "ip"           TEXT,
  "userAgent"    TEXT,
  "leadId"       TEXT,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FormularioResposta_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormularioResposta_formularioId_criadoEm_idx"
  ON "FormularioResposta"("formularioId", "criadoEm");
CREATE INDEX "FormularioResposta_leadId_idx" ON "FormularioResposta"("leadId");

ALTER TABLE "FormularioResposta" ADD CONSTRAINT "FormularioResposta_formularioId_fkey"
  FOREIGN KEY ("formularioId") REFERENCES "Formulario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
