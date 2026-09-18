-- RASTRO dos envios pra assinatura (adendo do card de 17/09).
--
-- O cliente pode pedir alteração de cláusula; o diretor alinha e manda o
-- contrato NOVO pra mesma proposta. Hoje `assinaturaId`/`assinaturaDocumentoId`
-- são UM só e seriam sobrescritos — o envelope anterior continuaria existindo na
-- ClickSign e ninguém conseguiria chegar nele, porque o endereço se perdeu.
--
-- 📌 Guarda o PONTEIRO, não o documento: o Léo decidiu que "o link pro ClickSign
-- basta". Cada envelope já vive lá, com o documento e os eventos de assinatura.
--
-- ⚠️ Não é versão jurídica — contrato não assinado não vincula ninguém. É rastro
-- operacional: quantas rodadas, quando, quem mandou e por quê.
--
-- Aditivo e nullable: contrato existente não muda de comportamento.
ALTER TABLE "Contrato"
  ADD COLUMN IF NOT EXISTS "enviosAssinatura" JSONB;
