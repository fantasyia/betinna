-- "Tem turno de IA aberto nesta conversa?" roda a CADA passo de fluxo
-- (`turnoDeIaAberto`, usado pelo guard do bus e pelo {{conversa.ia_aguardando}}
-- das condições). Sem este índice a consulta varre TODAS as execuções da
-- empresa — e essa tabela guarda o histórico inteiro, enquanto as vivas são
-- sempre poucas dezenas.
--
-- Parcial de propósito: só as vivas entram, então o índice fica minúsculo e o
-- planner vai direto nelas. Índice parcial não é declarável no schema.prisma —
-- por isso ele também mora em prisma/sql/objetos-invisiveis.sql, senão o
-- fallback `db push` do deploy o apaga em silêncio.
CREATE INDEX IF NOT EXISTS "FluxoExecucao_empresaId_vivas_idx"
  ON "FluxoExecucao" ("empresaId")
  WHERE status IN ('PENDENTE', 'EM_EXECUCAO', 'AGUARDANDO');
