-- CRIAR_TAREFA (fluxos) vira card Kanban no quadro do rep + espelho no quadro do Diretor.
-- Aditivo e compatível: colunas nullable, sem backfill obrigatório aqui (script separado
-- provisiona quadros dos reps existentes e etiqueta o quadro do Diretor já criado).

-- Quadros de sistema (rep_tarefas | diretor_tarefas) — resolução determinística por tenant.
ALTER TABLE "KanbanBoard" ADD COLUMN "tipoSistema" TEXT;
CREATE INDEX "KanbanBoard_empresaId_tipoSistema_idx" ON "KanbanBoard"("empresaId", "tipoSistema");

-- Espelho de card (rep→Diretor) + idempotência do passo do fluxo.
ALTER TABLE "KanbanCard" ADD COLUMN "origemCardId" TEXT;
ALTER TABLE "KanbanCard" ADD COLUMN "origemJobId" TEXT;
CREATE INDEX "KanbanCard_origemCardId_idx" ON "KanbanCard"("origemCardId");
CREATE INDEX "KanbanCard_origemJobId_idx" ON "KanbanCard"("origemJobId");
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_origemCardId_fkey"
  FOREIGN KEY ("origemCardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
