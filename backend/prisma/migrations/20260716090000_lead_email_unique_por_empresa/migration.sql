-- Índice ÚNICO parcial: 1 lead por e-mail (case-insensitive) por empresa.
-- Fecha a JANELA DE CORRIDA do import (snapshot de dedup lido uma vez + inserts
-- em loop de minutos → re-import concorrente criava 2 leads pro mesmo e-mail;
-- foi a causa dos 380 duplicados de 2026-07). Verificado em prod ANTES desta
-- migration: 0 e-mails duplicados entre os 27.240 leads — criação segura.
--
-- Telefone fica FORA de propósito: o sufixo-8 (D18) é heurística de MATCH, não
-- identidade — pessoas distintas podem dividir os últimos 8 dígitos (mesmo
-- número local em DDDs diferentes). Pro telefone vale o dedup em código.
--
-- Expressão LOWER(...) não é representável no schema.prisma (comentário lá).
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_empresa_email_lower_unique"
  ON "Lead" ("empresaId", LOWER("contatoEmail"))
  WHERE "contatoEmail" IS NOT NULL AND "contatoEmail" <> '';
