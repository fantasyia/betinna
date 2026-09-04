-- Telefone do signatário: a autenticação por SMS/WhatsApp da assinatura
-- eletrônica exige o número. Sem ele a assinatura cai pro token por e-mail.
ALTER TABLE "Proposta" ADD COLUMN IF NOT EXISTS "signatarioTelefone" TEXT;
