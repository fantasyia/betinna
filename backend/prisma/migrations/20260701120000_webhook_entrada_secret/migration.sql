-- Webhook de entrada: segredo HMAC por-tenant + idempotência forte (WebhookRecebimento).

-- Segredo HMAC por-tenant (nullable p/ legado; receiver exige presente).
ALTER TABLE "WebhookEntrada" ADD COLUMN "secret" TEXT;

-- Idempotência server-side (barra reprocessamento mesmo com Redis frio).
CREATE TABLE "WebhookRecebimento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookRecebimento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookRecebimento_webhookId_idempotencyKey_key" ON "WebhookRecebimento"("webhookId", "idempotencyKey");

CREATE INDEX "WebhookRecebimento_empresaId_idx" ON "WebhookRecebimento"("empresaId");

ALTER TABLE "WebhookRecebimento" ADD CONSTRAINT "WebhookRecebimento_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "WebhookEntrada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
