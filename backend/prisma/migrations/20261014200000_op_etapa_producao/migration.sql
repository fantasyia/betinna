-- Etapa de PRODUÇÃO da OP (Léo, 14/10): o kanban da produção. Separada do
-- status (que baixa estoque, registra envio e fecha o custo): a etapa só diz
-- onde a OP está no chão de fábrica. Só ADD — nada é apagado.
DO $$ BEGIN
  CREATE TYPE "OrdemProducaoEtapa" AS ENUM (
    'RASCUNHO', 'IMPRESSAO_RISCO', 'CORTE', 'COSTURA', 'ACABAMENTO', 'CONFERENCIA', 'CONCLUIDO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "OrdemProducao"
  ADD COLUMN IF NOT EXISTS "etapa" "OrdemProducaoEtapa" NOT NULL DEFAULT 'RASCUNHO';

-- As OPs que já existem entram na etapa equivalente ao status de hoje.
UPDATE "OrdemProducao" SET "etapa" = 'CORTE' WHERE "status" = 'CORTADA' AND "etapa" = 'RASCUNHO';
UPDATE "OrdemProducao" SET "etapa" = 'COSTURA' WHERE "status" = 'NA_FACCAO' AND "etapa" = 'RASCUNHO';
UPDATE "OrdemProducao" SET "etapa" = 'ACABAMENTO' WHERE "status" = 'RECEBENDO' AND "etapa" = 'RASCUNHO';
UPDATE "OrdemProducao" SET "etapa" = 'CONCLUIDO' WHERE "status" = 'FECHADA' AND "etapa" = 'RASCUNHO';
-- Rascunho com risco pronto: já está na impressão do risco.
UPDATE "OrdemProducao" o SET "etapa" = 'IMPRESSAO_RISCO'
WHERE o."status" = 'RASCUNHO' AND o."etapa" = 'RASCUNHO'
  AND EXISTS (SELECT 1 FROM "EncaixeJob" j WHERE j."opId" = o."id" AND j."status" = 'CONCLUIDO');
