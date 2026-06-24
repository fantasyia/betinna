-- #2 Comissao: inclui `tipo` na unique. O mesmo usuário pode ser REP e GERENTE no mesmo
-- mês (dois registros distintos); sem `tipo` o upsert de GERENTE sobrescrevia a comissão
-- REP do próprio usuário (colisão na chave (empresaId, representanteId, ano, mes)).
-- A nova unique é MAIS permissiva → nenhum dado existente a viola.
DROP INDEX "Comissao_empresaId_representanteId_ano_mes_key";
CREATE UNIQUE INDEX "Comissao_empresaId_representanteId_tipo_ano_mes_key" ON "Comissao"("empresaId", "representanteId", "tipo", "ano", "mes");

-- #3 AgendaItem.origemJobId: idempotência da ação CRIAR_TAREFA de fluxos. Coluna nullable;
-- unique em coluna nullable permite múltiplos NULL no Postgres (linhas antigas intactas).
ALTER TABLE "AgendaItem" ADD COLUMN "origemJobId" TEXT;
CREATE UNIQUE INDEX "AgendaItem_origemJobId_key" ON "AgendaItem"("origemJobId");
