-- Índice de expressão pra acelerar e firmar o match de cliente por telefone.
--
-- Contexto: o match é por SUFIXO de 8 dígitos do telefone (decisão D18), usado
-- toda vez que chega mensagem (Inbox) pra vincular ao cliente. Mas Cliente.telefone
-- é ARMAZENADO formatado (ex.: "(11) 98765-4321" — vem do OMIE via formatTelefone).
-- O match antigo fazia `telefone LIKE '%<8 dígitos>%'`: além de não usar índice
-- (seq scan dentro do tenant), QUEBRAVA quando o número formatado tinha hífen no
-- meio do sufixo (o LIKE procura a substring contígua, e o "-" a parte em dois).
--
-- Este índice normaliza o LADO ARMAZENADO (remove tudo que não é dígito, pega os
-- 8 finais) e indexa por (empresaId, sufixo). A query (InboxService.resolverCliente)
-- passa a usar a MESMA expressão com igualdade: robusto a formatação + Index Scan.
--
-- O Postgres mantém o índice sozinho a cada insert/update de telefone — a expressão
-- é IMMUTABLE (regexp_replace + right). Sem coluna nova, sem backfill, sem fiar
-- write-path. Índice invisível ao Prisma (não está no schema.prisma), mesmo padrão
-- dos índices únicos parciais da Conversation — não causa drift de schema-hash.

CREATE INDEX IF NOT EXISTS "Cliente_empresaId_telefoneSufixo_idx"
  ON "Cliente" ("empresaId", (RIGHT(REGEXP_REPLACE("telefone", '[^0-9]', '', 'g'), 8)));
