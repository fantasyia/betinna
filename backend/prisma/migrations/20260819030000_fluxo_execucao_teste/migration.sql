-- Marca de EXECUÇÃO DE TESTE (botão "testar" / MCP fluxos_testar).
--
-- Até aqui o teste só deixava `_teste: true` dentro do JSON do contexto, e as
-- métricas do painel contavam tudo junto: as duas execuções de teste do T1
-- respondiam por "0% de sucesso" num fluxo PAUSADO que nunca processou mensagem
-- real. O painel dizia que o fluxo mais importante do projeto falhava sempre.
--
-- Coluna e não filtro por JSON de propósito: excluir por caminho JSON no
-- Postgres tropeça em NULL (`NOT (contexto->'_teste' = 'true')` é NULL quando a
-- chave não existe, e a linha some do resultado) — o filtro esconderia
-- justamente as execuções de PRODUÇÃO, que é o oposto do pedido.
ALTER TABLE "FluxoExecucao" ADD COLUMN IF NOT EXISTS "teste" BOOLEAN NOT NULL DEFAULT false;

-- Backfill do que já existe: quem tem a marca no contexto vira teste de verdade.
UPDATE "FluxoExecucao"
   SET "teste" = true
 WHERE "teste" = false
   AND "contexto" -> '_teste' = 'true'::jsonb;

-- O painel filtra por (fluxo, teste) em toda leitura de métrica.
CREATE INDEX IF NOT EXISTS "FluxoExecucao_fluxoId_teste_idx"
    ON "FluxoExecucao" ("fluxoId", "teste");
