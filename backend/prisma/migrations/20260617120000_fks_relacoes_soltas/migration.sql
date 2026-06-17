-- Migration: Declarar 7 FKs soltas (anuláveis, onDelete: SetNull)
-- Para cada FK: (1) limpar órfãos pra o constraint não falhar em prod; (2) adicionar FK.

-- 1. Proposta.representanteId → Usuario
UPDATE "Proposta" SET "representanteId" = NULL WHERE "representanteId" IS NOT NULL AND "representanteId" NOT IN (SELECT "id" FROM "Usuario");
ALTER TABLE "Proposta" ADD CONSTRAINT "Proposta_representanteId_fkey" FOREIGN KEY ("representanteId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Ocorrencia.pedidoId → Pedido
UPDATE "Ocorrencia" SET "pedidoId" = NULL WHERE "pedidoId" IS NOT NULL AND "pedidoId" NOT IN (SELECT "id" FROM "Pedido");
ALTER TABLE "Ocorrencia" ADD CONSTRAINT "Ocorrencia_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Lead.pedidoId → Pedido
UPDATE "Lead" SET "pedidoId" = NULL WHERE "pedidoId" IS NOT NULL AND "pedidoId" NOT IN (SELECT "id" FROM "Pedido");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. FormularioResposta.leadId → Lead
UPDATE "FormularioResposta" SET "leadId" = NULL WHERE "leadId" IS NOT NULL AND "leadId" NOT IN (SELECT "id" FROM "Lead");
ALTER TABLE "FormularioResposta" ADD CONSTRAINT "FormularioResposta_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. BotResposta.conversationId → Conversation
UPDATE "BotResposta" SET "conversationId" = NULL WHERE "conversationId" IS NOT NULL AND "conversationId" NOT IN (SELECT "id" FROM "Conversation");
ALTER TABLE "BotResposta" ADD CONSTRAINT "BotResposta_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. BotResposta.messageId → Message
UPDATE "BotResposta" SET "messageId" = NULL WHERE "messageId" IS NOT NULL AND "messageId" NOT IN (SELECT "id" FROM "Message");
ALTER TABLE "BotResposta" ADD CONSTRAINT "BotResposta_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. MovimentoFidelidade.criadoPorId → Usuario
UPDATE "MovimentoFidelidade" SET "criadoPorId" = NULL WHERE "criadoPorId" IS NOT NULL AND "criadoPorId" NOT IN (SELECT "id" FROM "Usuario");
ALTER TABLE "MovimentoFidelidade" ADD CONSTRAINT "MovimentoFidelidade_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
