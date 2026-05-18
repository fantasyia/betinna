-- Cliente: campos de endereço completo + base pra validação BR.
--
-- Por que nullable: legado do OMIE import pode ter clientes sem todos os
-- campos. A obrigatoriedade fica no DTO (Zod) — quem cria via API precisa
-- preencher tudo; quem vem do OMIE pode ter campos opcionais.

ALTER TABLE "Cliente"
  ADD COLUMN "cep" TEXT,
  ADD COLUMN "endereco" TEXT,
  ADD COLUMN "numero" TEXT,
  ADD COLUMN "complemento" TEXT,
  ADD COLUMN "bairro" TEXT;
