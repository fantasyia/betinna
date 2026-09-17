-- PROPOSTA TÉCNICA (Anexo II) — o que faltava do documento.
--
-- 1. As DUAS tabelas do item 03: "3.1. Supressores de Surtos (Master Block)" e
--    "3.2. Hardwares" (Data Sense / End Point). Mesmas colunas, listas
--    separadas — e o MESMO quadro costuma aparecer nas duas, porque leva um
--    supressor e um hardware de monitoramento.
--
--    Campo EXPLÍCITO, não derivado do SKU: o catálogo não distingue os dois
--    (categoria/linha/marca estão nulos nos 39 produtos), e adivinhar por
--    convenção de nome quebraria no primeiro produto que fugir dela.
--
-- 2. Os prazos do item 04, em DIAS — "em até __ (____) dias, contados da
--    aceitação da proposta". É prazo RELATIVO ao aceite, não data no
--    calendário; convive com o `prazoEntrega` (DateTime) porque respondem
--    perguntas diferentes.
--
-- Tudo aditivo e nullable: proposta que já existe não muda de comportamento.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PropostaSecaoTecnica') THEN
    CREATE TYPE "PropostaSecaoTecnica" AS ENUM ('SUPRESSOR', 'HARDWARE');
  END IF;
END
$$;

ALTER TABLE "PropostaItem"
  ADD COLUMN IF NOT EXISTS "secaoTecnica" "PropostaSecaoTecnica";

ALTER TABLE "Proposta"
  ADD COLUMN IF NOT EXISTS "prazoEntregaDias" INTEGER,
  ADD COLUMN IF NOT EXISTS "prazoInstalacaoDias" INTEGER,
  ADD COLUMN IF NOT EXISTS "prazoSoftwareDias" INTEGER;
