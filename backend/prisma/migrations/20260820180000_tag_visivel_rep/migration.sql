-- Tags que o REP usa. Default false: tag nova nasce só pra gestão, e as
-- operacionais (triagem, e-mail mkt, gatilhos de fluxo) somem da tela dele.
ALTER TABLE "Tag" ADD COLUMN "visivelParaRep" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Tag_empresaId_visivelParaRep_idx" ON "Tag"("empresaId", "visivelParaRep");
