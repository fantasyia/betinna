-- ============================================================================
-- LIMPEZA DE DADOS DE TESTE — betinna.ai  ("começar do zero")
-- ============================================================================
-- IRREVERSÍVEL. Apaga TODO o dado operacional (clientes, produtos, pedidos,
-- conversas, etc.) e MANTÉM a estrutura: empresas, usuários, permissões,
-- integrações, personas do bot, funis, fluxos, tags, metas, segmentos.
--
-- COMO USAR (no painel do Supabase → SQL Editor):
--   1) Rode SÓ a PARTE 1 (SELECT) e confira os números do que será apagado.
--   2) Se estiver tudo certo, rode a PARTE 2 (a limpeza de verdade).
--   3) (Opcional) PARTE 3 zera também a configuração (funis/fluxos/tags/etc.)
--      se você quiser a plataforma TOTALMENTE em branco.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 1 — CONTAGEM (não apaga nada — só revisão)
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'clientes'      AS tabela, COUNT(*) AS qtd FROM "Cliente"
UNION ALL SELECT 'produtos',      COUNT(*) FROM "Produto"
UNION ALL SELECT 'pedidos',       COUNT(*) FROM "Pedido"
UNION ALL SELECT 'propostas',     COUNT(*) FROM "Proposta"
UNION ALL SELECT 'comissoes',     COUNT(*) FROM "Comissao"
UNION ALL SELECT 'amostras',      COUNT(*) FROM "Amostra"
UNION ALL SELECT 'leads',         COUNT(*) FROM "Lead"
UNION ALL SELECT 'ocorrencias',   COUNT(*) FROM "Ocorrencia"
UNION ALL SELECT 'conversas',     COUNT(*) FROM "Conversation"
UNION ALL SELECT 'mensagens',     COUNT(*) FROM "Message"
UNION ALL SELECT 'agenda',        COUNT(*) FROM "AgendaItem"
UNION ALL SELECT 'campanhas',     COUNT(*) FROM "Campanha"
UNION ALL SELECT 'respostas_nps', COUNT(*) FROM "RespostaNPS"
UNION ALL SELECT 'notificacoes',  COUNT(*) FROM "Notificacao"
ORDER BY qtd DESC;

-- Confira também o que será MANTIDO:
SELECT 'EMPRESAS (mantidas)' AS tabela, COUNT(*) AS qtd FROM "Empresa"
UNION ALL SELECT 'USUARIOS (mantidos)',     COUNT(*) FROM "Usuario"
UNION ALL SELECT 'INTEGRACOES (mantidas)',  COUNT(*) FROM "IntegracaoConexao";


-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 2 — LIMPEZA (APAGA o dado operacional). Rode só após conferir a Parte 1.
-- ─────────────────────────────────────────────────────────────────────────
-- TRUNCATE ... CASCADE apaga as tabelas listadas + tudo que depende delas,
-- numa transação atômica. A estrutura (empresas/usuários/etc.) NÃO é tocada
-- porque ela não depende destas tabelas.
TRUNCATE TABLE
  "Message",
  "Conversation",
  "MarketplaceIncident",
  "MarketplaceMsg",
  "MarketplaceOrder",
  "OcorrenciaComentario",
  "Ocorrencia",
  "CampanhaDestinatario",
  "Campanha",
  "PropostaItem",
  "Proposta",
  "AprovacaoDesconto",
  "PedidoCancelamentoSolicitacao",
  "PedidoItem",
  "Pedido",
  "Comissao",
  "Amostra",
  "Lead",
  "AgendaItem",
  "RespostaNPS",
  "FormularioResposta",
  "FluxoExecucaoLog",
  "FluxoExecucao",
  "Notificacao",
  "RepCatalogoItem",
  "ClientePrecoEspecial",
  "ClienteTag",
  "NotaPrivada",
  "Documento",
  "Produto",
  "Cliente"
RESTART IDENTITY CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 3 — OPCIONAL: zerar também a CONFIGURAÇÃO (deixar 100% em branco).
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ Só rode se quiser apagar TAMBÉM os funis, fluxos, tags, metas, segmentos
-- e a persona do bot que você criou testando. Mantém empresas/usuários/integrações.
-- Remova os "--" do começo das linhas abaixo pra ativar.
--
-- TRUNCATE TABLE
--   "FunilEtapa", "Funil",
--   "FluxoEdge", "FluxoNo", "Fluxo",
--   "ClienteTag", "Tag",
--   "Meta",
--   "Segmento",
--   "PesquisaNPS",
--   "FormularioCampo", "Formulario",
--   "MullerBotPersona",
--   "MovimentoFidelidade", "SaldoFidelidade", "RecompensaFidelidade", "ProgramaFidelidade"
-- RESTART IDENTITY CASCADE;
