-- PAT de plataforma: escopo de módulos no token de API (aditivo, compatível).
-- Tokens existentes ganham default ["kanban"] → seguem válidos só no Kanban.
ALTER TABLE "KanbanApiToken" ADD COLUMN "escopo" TEXT[] NOT NULL DEFAULT ARRAY['kanban']::text[];
