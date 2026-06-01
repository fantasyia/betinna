-- ============================================================================
-- LIMPEZA DE DADOS DE TESTE — betinna.ai  ("começar do zero")
-- ============================================================================
-- IRREVERSÍVEL. Apaga TODO o dado de teste e MANTÉM a estrutura essencial:
-- empresas, usuários, permissões, integrações, persona do bot e o histórico
-- de migrations.
--
-- Abordagem robusta: em vez de listar nome por nome (frágil — um nome errado
-- aborta tudo), apaga TODAS as tabelas do schema MENOS as da lista "manter".
--
-- COMO USAR (Supabase → SQL Editor):
--   1) Rode a PARTE 1 (SELECT) e confira os números.
--   2) Se estiver certo, rode a PARTE 2 (a limpeza).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 1 — CONTAGEM (não apaga nada — só revisão)
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'clientes'  AS tabela, COUNT(*) AS qtd FROM "Cliente"
UNION ALL SELECT 'produtos',  COUNT(*) FROM "Produto"
UNION ALL SELECT 'pedidos',   COUNT(*) FROM "Pedido"
UNION ALL SELECT 'conversas', COUNT(*) FROM "Conversation"
UNION ALL SELECT 'EMPRESAS (mantidas)', COUNT(*) FROM "Empresa"
UNION ALL SELECT 'USUARIOS (mantidos)', COUNT(*) FROM "Usuario"
ORDER BY qtd DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 2 — LIMPEZA (apaga tudo menos a estrutura). Rode após conferir a Parte 1.
-- ─────────────────────────────────────────────────────────────────────────
-- Trunca todas as tabelas do schema public, exceto a lista "manter".
-- CASCADE resolve as dependências; RESTART IDENTITY zera os contadores.
DO $$
DECLARE tabelas text;
BEGIN
  SELECT string_agg(format('%I', tablename), ', ')
  INTO tabelas
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN (
      '_prisma_migrations',   -- histórico de migrations (NÃO apagar)
      'Empresa',
      'Usuario',
      'UsuarioEmpresa',
      'Permissao',
      'IntegracaoConexao',
      'UsuarioIntegracao',
      'IntegracaoStatus',
      'EmpresaSequence',
      'MullerBotPersona'
    );
  IF tabelas IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || tabelas || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;
