-- Quando a PESSOA autorizou a integração — distinto de quando a linha nasceu.
--
-- A tela de /usuario/integracoes mostrava `criadoEm`. Como `desconectar` só
-- marca ativo=false (não apaga a linha) e o upsert a reaproveita, reconectar
-- preservava a data original pra sempre.
ALTER TABLE "UsuarioIntegracao" ADD COLUMN "conectadoEm" TIMESTAMP(3);

-- Backfill: `atualizadoEm` é a melhor aproximação que existe pro que já está
-- gravado. Erra pra mais nas conexões que sofreram refresh de token depois da
-- autorização, mas erra MENOS que `criadoEm`, que é o bug. Linha nova nasce
-- com o valor certo, então isto só cobre o legado.
UPDATE "UsuarioIntegracao" SET "conectadoEm" = "atualizadoEm" WHERE "conectadoEm" IS NULL;

-- Mesmo buraco na tabela de integrações da EMPRESA: `desconectar` só marca
-- ativo=false, o upsert reaproveita a linha, e a tela mostra `criadoEm`.
ALTER TABLE "IntegracaoConexao" ADD COLUMN "conectadoEm" TIMESTAMP(3);
UPDATE "IntegracaoConexao" SET "conectadoEm" = "atualizadoEm" WHERE "conectadoEm" IS NULL;
