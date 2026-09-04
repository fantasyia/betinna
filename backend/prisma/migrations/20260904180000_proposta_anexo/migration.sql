-- O projeto do cliente anexado à proposta. A proposta não sai pro cliente
-- aprovar sem ele: o que se aprova é o projeto, não só preço e prazo.
CREATE TABLE "PropostaAnexo" (
  "id"         TEXT NOT NULL,
  "propostaId" TEXT NOT NULL,
  "nome"       TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "mime"       TEXT NOT NULL,
  "tamanho"    INTEGER NOT NULL,
  "criadoPor"  TEXT,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PropostaAnexo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropostaAnexo_propostaId_idx" ON "PropostaAnexo"("propostaId");

ALTER TABLE "PropostaAnexo"
  ADD CONSTRAINT "PropostaAnexo_propostaId_fkey"
  FOREIGN KEY ("propostaId") REFERENCES "Proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
