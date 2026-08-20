-- REP passa a ver Relatórios (os números da carteira DELE — todo endpoint de
-- relatório já filtra por RepScope).
--
-- Precisa de migration porque o seed de permissões é CREATE-ONLY: a linha
-- REP:relatorios já existe (semeada com podeVer=false), então mudar só o
-- DEFAULT_PERMISSIONS no código não a corrigiria nunca.
--
-- A condição extra protege customização: se algum admin já mexeu nesta linha
-- (ligou o ver, ou deu ações), ela NÃO é tocada — só sai do estado default.
UPDATE "Permissao"
   SET "podeVer" = true,
       "acoes"   = ARRAY['view']::text[]
 WHERE "role"    = 'REP'
   AND "modulo"  = 'relatorios'
   AND "podeVer" = false
   AND cardinality("acoes") = 0;
