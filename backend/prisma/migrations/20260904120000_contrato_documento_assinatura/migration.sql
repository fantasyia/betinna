-- O webhook de assinatura do ClickSign identifica o DOCUMENTO, não o envelope.
-- Sem guardar o id do documento, o retorno chega e não há como saber de qual
-- contrato ele é.
ALTER TABLE "Contrato" ADD COLUMN IF NOT EXISTS "assinaturaDocumentoId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Contrato_assinaturaDocumentoId_key"
  ON "Contrato"("assinaturaDocumentoId");
