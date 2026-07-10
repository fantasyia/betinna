-- Kanban (estilo Trello) + tokens de API pro MCP — docs/kanban-betinna-EM-BATCHES.md (Batch 1)
-- Só objetos novos (15 tabelas Kanban*): aditivo, não toca em nada existente.

CREATE TABLE "KanbanBoard" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "corFundo" TEXT NOT NULL DEFAULT '#0079BF',
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "empresaId" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KanbanBoard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanBoardMembro" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'membro',

    CONSTRAINT "KanbanBoardMembro_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanLista" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "posicao" DOUBLE PRECISION NOT NULL,
    "arquivada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "KanbanLista_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanCard" (
    "id" TEXT NOT NULL,
    "listaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "posicao" DOUBLE PRECISION NOT NULL,
    "dataInicio" TIMESTAMP(3),
    "dataEntrega" TIMESTAMP(3),
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "corCapa" TEXT,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KanbanCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanEtiqueta" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "nome" TEXT,
    "cor" TEXT NOT NULL,

    CONSTRAINT "KanbanEtiqueta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanCardEtiqueta" (
    "cardId" TEXT NOT NULL,
    "etiquetaId" TEXT NOT NULL,

    CONSTRAINT "KanbanCardEtiqueta_pkey" PRIMARY KEY ("cardId","etiquetaId")
);

CREATE TABLE "KanbanCardMembro" (
    "cardId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,

    CONSTRAINT "KanbanCardMembro_pkey" PRIMARY KEY ("cardId","usuarioId")
);

CREATE TABLE "KanbanChecklist" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "posicao" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "KanbanChecklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "posicao" DOUBLE PRECISION NOT NULL,
    "dataEntrega" TIMESTAMP(3),
    "responsavelId" TEXT,

    CONSTRAINT "KanbanChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanCampoPersonalizado" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "opcoes" JSONB,

    CONSTRAINT "KanbanCampoPersonalizado_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanCampoValor" (
    "id" TEXT NOT NULL,
    "campoId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "valor" JSONB NOT NULL,

    CONSTRAINT "KanbanCampoValor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanComentario" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KanbanComentario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanAnexo" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KanbanAnexo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanAtividade" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "cardId" TEXT,
    "usuarioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KanbanAtividade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KanbanApiToken" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ultimoUso" TIMESTAMP(3),
    "revogado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KanbanApiToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KanbanBoard_empresaId_idx" ON "KanbanBoard"("empresaId");

CREATE INDEX "KanbanBoard_criadoPorId_idx" ON "KanbanBoard"("criadoPorId");

CREATE INDEX "KanbanBoardMembro_usuarioId_idx" ON "KanbanBoardMembro"("usuarioId");

CREATE UNIQUE INDEX "KanbanBoardMembro_boardId_usuarioId_key" ON "KanbanBoardMembro"("boardId", "usuarioId");

CREATE INDEX "KanbanLista_boardId_idx" ON "KanbanLista"("boardId");

CREATE INDEX "KanbanCard_listaId_idx" ON "KanbanCard"("listaId");

CREATE INDEX "KanbanCard_dataEntrega_idx" ON "KanbanCard"("dataEntrega");

CREATE INDEX "KanbanEtiqueta_boardId_idx" ON "KanbanEtiqueta"("boardId");

CREATE INDEX "KanbanCardEtiqueta_etiquetaId_idx" ON "KanbanCardEtiqueta"("etiquetaId");

CREATE INDEX "KanbanCardMembro_usuarioId_idx" ON "KanbanCardMembro"("usuarioId");

CREATE INDEX "KanbanChecklist_cardId_idx" ON "KanbanChecklist"("cardId");

CREATE INDEX "KanbanChecklistItem_checklistId_idx" ON "KanbanChecklistItem"("checklistId");

CREATE INDEX "KanbanChecklistItem_responsavelId_dataEntrega_idx" ON "KanbanChecklistItem"("responsavelId", "dataEntrega");

CREATE INDEX "KanbanCampoPersonalizado_boardId_idx" ON "KanbanCampoPersonalizado"("boardId");

CREATE INDEX "KanbanCampoValor_cardId_idx" ON "KanbanCampoValor"("cardId");

CREATE UNIQUE INDEX "KanbanCampoValor_campoId_cardId_key" ON "KanbanCampoValor"("campoId", "cardId");

CREATE INDEX "KanbanComentario_cardId_idx" ON "KanbanComentario"("cardId");

CREATE INDEX "KanbanAnexo_cardId_idx" ON "KanbanAnexo"("cardId");

CREATE INDEX "KanbanAtividade_boardId_criadoEm_idx" ON "KanbanAtividade"("boardId", "criadoEm");

CREATE INDEX "KanbanAtividade_cardId_idx" ON "KanbanAtividade"("cardId");

CREATE UNIQUE INDEX "KanbanApiToken_tokenHash_key" ON "KanbanApiToken"("tokenHash");

CREATE INDEX "KanbanApiToken_usuarioId_idx" ON "KanbanApiToken"("usuarioId");

-- Foreign keys
ALTER TABLE "KanbanBoard" ADD CONSTRAINT "KanbanBoard_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanBoard" ADD CONSTRAINT "KanbanBoard_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanBoardMembro" ADD CONSTRAINT "KanbanBoardMembro_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "KanbanBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanBoardMembro" ADD CONSTRAINT "KanbanBoardMembro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanLista" ADD CONSTRAINT "KanbanLista_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "KanbanBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_listaId_fkey" FOREIGN KEY ("listaId") REFERENCES "KanbanLista"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanEtiqueta" ADD CONSTRAINT "KanbanEtiqueta_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "KanbanBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCardEtiqueta" ADD CONSTRAINT "KanbanCardEtiqueta_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCardEtiqueta" ADD CONSTRAINT "KanbanCardEtiqueta_etiquetaId_fkey" FOREIGN KEY ("etiquetaId") REFERENCES "KanbanEtiqueta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCardMembro" ADD CONSTRAINT "KanbanCardMembro_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCardMembro" ADD CONSTRAINT "KanbanCardMembro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanChecklist" ADD CONSTRAINT "KanbanChecklist_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanChecklistItem" ADD CONSTRAINT "KanbanChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "KanbanChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanChecklistItem" ADD CONSTRAINT "KanbanChecklistItem_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KanbanCampoPersonalizado" ADD CONSTRAINT "KanbanCampoPersonalizado_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "KanbanBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCampoValor" ADD CONSTRAINT "KanbanCampoValor_campoId_fkey" FOREIGN KEY ("campoId") REFERENCES "KanbanCampoPersonalizado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCampoValor" ADD CONSTRAINT "KanbanCampoValor_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanComentario" ADD CONSTRAINT "KanbanComentario_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanComentario" ADD CONSTRAINT "KanbanComentario_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanAnexo" ADD CONSTRAINT "KanbanAnexo_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KanbanCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanAtividade" ADD CONSTRAINT "KanbanAtividade_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "KanbanBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanAtividade" ADD CONSTRAINT "KanbanAtividade_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanApiToken" ADD CONSTRAINT "KanbanApiToken_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanApiToken" ADD CONSTRAINT "KanbanApiToken_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
