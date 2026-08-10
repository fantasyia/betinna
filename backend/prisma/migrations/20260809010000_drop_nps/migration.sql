-- Remove o módulo de NPS do banco.
--
-- Decisão de PRODUTO (Léo, 2026-08): NPS não vai existir no Betinna. O módulo já
-- estava desligado no app.module (nenhuma rota /nps registrada); esta migration
-- tira o resto — as duas tabelas e as FKs pra Empresa/Cliente.
--
-- Conferido antes de escrever: PesquisaNPS = 0 linhas, RespostaNPS = 0 linhas em
-- produção. Nenhum dado perdido.
--
-- RespostaNPS primeiro: tem FK pra PesquisaNPS (onDelete: Cascade) e pra Cliente.
DROP TABLE IF EXISTS "RespostaNPS";
DROP TABLE IF EXISTS "PesquisaNPS";
