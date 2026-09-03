-- Quem assina o contrato pelo cliente. Pessoa, não empresa: a assinatura
-- eletrônica recusa razão social como nome de signatário, e o Cliente do app só
-- guarda razão social. Fica na proposta porque quem assina é decisão do negócio.
ALTER TABLE "Proposta"
  ADD COLUMN IF NOT EXISTS "signatarioNome"  TEXT,
  ADD COLUMN IF NOT EXISTS "signatarioEmail" TEXT;
