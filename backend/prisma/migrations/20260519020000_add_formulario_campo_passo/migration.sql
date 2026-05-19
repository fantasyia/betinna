-- AlterTable: adiciona passo multi-step em FormularioCampo (v1.5.0)
ALTER TABLE "FormularioCampo" ADD COLUMN "passo" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "FormularioCampo_formularioId_passo_idx" ON "FormularioCampo"("formularioId", "passo");
