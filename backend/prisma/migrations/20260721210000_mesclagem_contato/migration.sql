-- Mesclagem de contatos duplicados — registro que permite DESFAZER.
--
-- Mesclar apaga o registro absorvido. Sem guardar o que ele era (e pra onde cada
-- vínculo foi), um par mesclado por engano vira perda definitiva de histórico e
-- da atribuição de campanha — dado que não se reconstrói.
--
-- `tipo`:
--   lead_lead     = fusão destrutiva (duplicata de verdade)
--   lead_cliente  = apenas VÍNCULO, nada é apagado (o Lead guarda a história de
--                   aquisição, o Cliente a relação comercial; um cliente pode
--                   virar lead de novo numa recompra)
CREATE TABLE IF NOT EXISTS "MesclagemContato" (
  "id"          TEXT NOT NULL,
  "empresaId"   TEXT NOT NULL,
  "tipo"        TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "absorvidoId" TEXT NOT NULL,
  "snapshot"    JSONB NOT NULL,
  "quem"        TEXT,
  "criadoEm"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "desfeitaEm"  TIMESTAMP(3),
  CONSTRAINT "MesclagemContato_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "MesclagemContato"
    ADD CONSTRAINT "MesclagemContato_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Feed de mesclagens do tenant (auditoria + histórico).
CREATE INDEX IF NOT EXISTS "MesclagemContato_empresaId_criadoEm_idx"
  ON "MesclagemContato" ("empresaId", "criadoEm");
-- "este contato já foi mesclado?" — nos dois papéis.
CREATE INDEX IF NOT EXISTS "MesclagemContato_principalId_idx"
  ON "MesclagemContato" ("principalId");
CREATE INDEX IF NOT EXISTS "MesclagemContato_absorvidoId_idx"
  ON "MesclagemContato" ("absorvidoId");
