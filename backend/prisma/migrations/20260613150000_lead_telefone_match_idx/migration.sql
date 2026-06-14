-- Índice de expressão pra acelerar o match de LEAD por telefone no gate do bot.
--
-- Contexto: cada mensagem recebida dispara, no gate do MullerBot, busca de lead por
-- SUFIXO de 8 dígitos do telefone (decisão D18) — antes em DOIS pontos
-- (fluxoIaConduzindo + leadEncerrado), ambos com `LIKE '%sufixo%'` = seq scan dentro
-- do tenant. Numa campanha de 500 leads respondendo, isso multiplica.
--
-- Este índice normaliza o lado armazenado (tira não-dígitos, pega os 8 finais) e
-- indexa por (empresaId, sufixo) — mesma técnica do índice de Cliente. A busca do
-- gate passa a usar a MESMA expressão com igualdade (Index Scan) e foi unificada
-- numa só.
--
-- Postgres mantém o índice sozinho (expressão IMMUTABLE: regexp_replace + right).
-- Sem coluna nova, sem backfill, sem drift de schema (índice invisível ao Prisma,
-- igual aos índices parciais da Conversation e ao de Cliente).

CREATE INDEX IF NOT EXISTS "Lead_empresaId_telefoneSufixo_idx"
  ON "Lead" ("empresaId", (RIGHT(REGEXP_REPLACE("contatoTelefone", '[^0-9]', '', 'g'), 8)));
