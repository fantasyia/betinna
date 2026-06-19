-- Drop de índices redundantes: cada `@@index([empresaId])` (e um `[usuarioId]`)
-- abaixo já é PREFIXO de um índice composto/unique existente no mesmo model.
-- O Postgres usa o composto/unique pra consultas só pela coluna líder, então o
-- índice de coluna única é puro overhead de escrita + disco (zero ganho de leitura).
-- Drop seguro: não altera plano de query (o composto cobre o prefixo).
--
-- Coberturas (índice dropado → quem já cobre):
--   Cliente_empresaId_idx           → unique(empresaId, codigoOmie) + (empresaId, criadoEm)
--   Tag_empresaId_idx               → unique(empresaId, nome) + (empresaId, funilId)
--   Pedido_empresaId_idx            → unique(empresaId, numero) + (empresaId, status, criadoEm)
--   Proposta_empresaId_idx          → unique(empresaId, numero) + (empresaId, isDemo)
--   Amostra_empresaId_idx           → (empresaId, isDemo)
--   Comissao_empresaId_idx          → unique(empresaId, representanteId, ano, mes)
--   AgendaItem_empresaId_idx        → (empresaId, data)
--   Conversation_empresaId_idx      → (empresaId, canal, peerId, proprietarioId)
--   IntegracaoConexao_empresaId_idx → unique(empresaId, servico)
--   IntegracaoStatus_empresaId_idx  → unique(empresaId, servico)
--   UsuarioIntegracao_usuarioId_idx → unique(usuarioId, servico)
--   BotPrompt_empresaId_idx         → unique(empresaId, nome) + (empresaId, isPadrao)
--   VariavelCustomizada_empresaId_idx → unique(empresaId, chave)
--   BotUsoTokens_empresaId_idx      → unique(empresaId, dia)

DROP INDEX IF EXISTS "Cliente_empresaId_idx";
DROP INDEX IF EXISTS "Tag_empresaId_idx";
DROP INDEX IF EXISTS "Pedido_empresaId_idx";
DROP INDEX IF EXISTS "Proposta_empresaId_idx";
DROP INDEX IF EXISTS "Amostra_empresaId_idx";
DROP INDEX IF EXISTS "Comissao_empresaId_idx";
DROP INDEX IF EXISTS "AgendaItem_empresaId_idx";
DROP INDEX IF EXISTS "Conversation_empresaId_idx";
DROP INDEX IF EXISTS "IntegracaoConexao_empresaId_idx";
DROP INDEX IF EXISTS "IntegracaoStatus_empresaId_idx";
DROP INDEX IF EXISTS "UsuarioIntegracao_usuarioId_idx";
DROP INDEX IF EXISTS "BotPrompt_empresaId_idx";
DROP INDEX IF EXISTS "VariavelCustomizada_empresaId_idx";
DROP INDEX IF EXISTS "BotUsoTokens_empresaId_idx";
