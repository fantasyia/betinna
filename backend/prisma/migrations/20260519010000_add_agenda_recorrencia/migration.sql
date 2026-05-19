-- CreateEnum
CREATE TYPE "Recorrencia" AS ENUM ('NENHUMA', 'DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL', 'ANUAL');

-- AlterTable
ALTER TABLE "AgendaItem" ADD COLUMN "recorrencia" "Recorrencia" NOT NULL DEFAULT 'NENHUMA',
ADD COLUMN "parentId" TEXT;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "AgendaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AgendaItem_parentId_idx" ON "AgendaItem"("parentId");
