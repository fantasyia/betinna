-- Participação fixa na LOCAÇÃO, separada da comissão do representante.
--
-- Regra do Léo (09/09): "para locação é 5% pro Leonardo, 5% pro Harada e 10%
-- pro representante, só isso, só essa regra".
--
-- São DUAS coisas diferentes e precisam de tipos diferentes: quando o próprio
-- Harada é o representante do contrato, ele recebe as duas (5% + 10%), e a
-- chave única é (contrato, usuário, TIPO, competência) — com um tipo só, a
-- segunda linha sobrescreveria a primeira e ele receberia metade.
ALTER TYPE "ComissaoTipo" ADD VALUE IF NOT EXISTS 'PARTICIPACAO';
