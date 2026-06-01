-- #25 Fatia 1: notas internas + tags de triagem por conversa.

-- AlterTable: tags internas de triagem (só a equipe vê).
ALTER TABLE "Conversation" ADD COLUMN "tagsInternas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable: notas internas (anotações da equipe; cliente não vê).
CREATE TABLE "ConversationNota" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationNota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationNota_conversationId_idx" ON "ConversationNota"("conversationId");

-- AddForeignKey
ALTER TABLE "ConversationNota" ADD CONSTRAINT "ConversationNota_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNota" ADD CONSTRAINT "ConversationNota_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
