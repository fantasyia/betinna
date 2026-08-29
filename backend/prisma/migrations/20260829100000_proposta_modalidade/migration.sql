-- Proposta é de VENDA ou de LOCAÇÃO.
-- O representante vende locação; sem isto a proposta dele saía com preço de
-- venda — o número errado chegando no cliente.
DO $$ BEGIN
  CREATE TYPE "PropostaModalidade" AS ENUM ('VENDA', 'LOCACAO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Proposta"
  ADD COLUMN IF NOT EXISTS "modalidade" "PropostaModalidade" NOT NULL DEFAULT 'VENDA';
