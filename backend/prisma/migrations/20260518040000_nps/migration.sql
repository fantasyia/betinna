-- NPS: PesquisaNPS + RespostaNPS

CREATE TABLE "PesquisaNPS" (
  "id"                    TEXT NOT NULL,
  "empresaId"             TEXT NOT NULL,
  "slug"                  TEXT NOT NULL,
  "titulo"                TEXT NOT NULL,
  "descricao"             TEXT,
  "mensagemAgradecimento" TEXT,
  "pergunta"              TEXT NOT NULL DEFAULT 'O quanto você nos recomendaria de 0 a 10?',
  "perguntaFollowUp"      TEXT DEFAULT 'Conta pra gente o que motivou essa nota',
  "ativo"                 BOOLEAN NOT NULL DEFAULT true,
  "expiraEm"              TIMESTAMP(3),
  "criadoEm"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PesquisaNPS_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PesquisaNPS_slug_key" ON "PesquisaNPS"("slug");
CREATE INDEX "PesquisaNPS_empresaId_ativo_idx" ON "PesquisaNPS"("empresaId", "ativo");

ALTER TABLE "PesquisaNPS" ADD CONSTRAINT "PesquisaNPS_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RespostaNPS" (
  "id"         TEXT NOT NULL,
  "pesquisaId" TEXT NOT NULL,
  "nota"       INTEGER NOT NULL,
  "comentario" TEXT,
  "contato"    TEXT,
  "clienteId"  TEXT,
  "categoria"  TEXT NOT NULL,
  "ip"         TEXT,
  "userAgent"  TEXT,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RespostaNPS_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RespostaNPS_pesquisaId_criadoEm_idx" ON "RespostaNPS"("pesquisaId", "criadoEm");
CREATE INDEX "RespostaNPS_pesquisaId_categoria_idx" ON "RespostaNPS"("pesquisaId", "categoria");
CREATE INDEX "RespostaNPS_clienteId_idx" ON "RespostaNPS"("clienteId");

ALTER TABLE "RespostaNPS" ADD CONSTRAINT "RespostaNPS_pesquisaId_fkey"
  FOREIGN KEY ("pesquisaId") REFERENCES "PesquisaNPS"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RespostaNPS" ADD CONSTRAINT "RespostaNPS_clienteId_fkey"
  FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
