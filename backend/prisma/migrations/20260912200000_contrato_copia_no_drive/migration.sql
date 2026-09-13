-- Cópia do contrato assinado no Google Drive.
--
-- O PDF continua morando no Storage do app (documentoUrl) — isto aqui é a
-- SEGUNDA cópia, onde quem não abre a Betinna alcança: contador, jurídico,
-- diretor no celular. Nasceu porque o Tiny não anexa arquivo em contrato
-- (medido contra a API em 12/09/2026).
--
-- Nulo é o estado normal: ninguém é obrigado a conectar o Google, e contrato
-- sem cópia no Drive não é contrato com defeito.
ALTER TABLE "Contrato" ADD COLUMN IF NOT EXISTS "driveArquivoId" TEXT;
ALTER TABLE "Contrato" ADD COLUMN IF NOT EXISTS "driveUrl" TEXT;
