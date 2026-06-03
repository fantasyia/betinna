-- Orquestração Fase B — gatilhos/ações de IA, tags em leads, SLA/capacidade,
-- pausa-retoma de execução e prioridade de disparo em lote.
-- Tudo aditivo: novos valores de enum, colunas anuláveis e tabela de ligação.
-- (Os valores de enum são apenas ADICIONADOS aqui, não usados — seguro no PG.)

-- AlterEnum: novos gatilhos de fluxo
ALTER TYPE "FluxoTriggerTipo" ADD VALUE 'LEAD_RESPONDEU';
ALTER TYPE "FluxoTriggerTipo" ADD VALUE 'LEAD_SEM_RESPOSTA';
ALTER TYPE "FluxoTriggerTipo" ADD VALUE 'IA_CLASSIFICOU';
ALTER TYPE "FluxoTriggerTipo" ADD VALUE 'LEAD_RECEBEU_TAG';

-- AlterEnum: novas ações de fluxo
ALTER TYPE "FluxoAcaoTipo" ADD VALUE 'CONVERSAR_IA';
ALTER TYPE "FluxoAcaoTipo" ADD VALUE 'LIBERAR_LOTE';

-- AlterEnum: novo status de execução (pausada aguardando resposta)
ALTER TYPE "FluxoExecucaoStatus" ADD VALUE 'AGUARDANDO';

-- AlterTable: Tag — metadados (descrição, escopo de funil, categoria)
ALTER TABLE "Tag"
  ADD COLUMN "descricao" TEXT,
  ADD COLUMN "funilId" TEXT,
  ADD COLUMN "categoria" TEXT;

-- AlterTable: Lead — prioridade pro disparo em lote ("coluna LEO")
ALTER TABLE "Lead" ADD COLUMN "ordemPrioridade" INTEGER;

-- AlterTable: FunilEtapa — ação de SLA vencido + capacidade máxima
ALTER TABLE "FunilEtapa"
  ADD COLUMN "acaoSlaExpirado" JSONB,
  ADD COLUMN "capacidadeMaxima" INTEGER;

-- AlterTable: FluxoExecucao — pausa/retoma (nó Conversar com IA)
ALTER TABLE "FluxoExecucao"
  ADD COLUMN "aguardandoNoId" TEXT,
  ADD COLUMN "timeoutEm" TIMESTAMP(3);

-- CreateTable: LeadTag (ligação lead ↔ tag)
CREATE TABLE "LeadTag" (
    "leadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "origem" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadTag_pkey" PRIMARY KEY ("leadId","tagId")
);

-- CreateIndex
CREATE INDEX "LeadTag_tagId_idx" ON "LeadTag"("tagId");
CREATE INDEX "Tag_empresaId_funilId_idx" ON "Tag"("empresaId", "funilId");

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
