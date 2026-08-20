-- Quais funis o REPRESENTANTE enxerga.
--
-- Até aqui `GET /funis` devolvia TODOS os funis da empresa pra qualquer papel.
-- O rep via "Triagem (WhatsApp)" (caixa de entrada bruta do SAC), "Nutrição
-- (E-Mail Marketing)" e "Prospecção Reps" — este último é o funil de
-- RECRUTAMENTO DE REPRESENTANTES, ou seja, o rep via a esteira em que ele
-- próprio foi captado, junto com os concorrentes dele.
--
-- Default `false`: rep não vê funil nenhum até alguém marcar. É o lado seguro —
-- errar pra cá esconde algo de quem devia ver (visível na hora, fácil de
-- corrigir); errar pro outro lado mostra pipeline interno e ninguém percebe.
ALTER TABLE "Funil" ADD COLUMN IF NOT EXISTS "visivelParaRep" BOOLEAN NOT NULL DEFAULT false;

-- Índice do filtro que a listagem do rep passa a fazer.
CREATE INDEX IF NOT EXISTS "Funil_empresaId_visivelParaRep_idx"
    ON "Funil" ("empresaId", "visivelParaRep");
