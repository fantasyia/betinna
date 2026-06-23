-- turnoIniciadoEm: carimbo do início do turno ATUAL do nó Conversar com IA (setado ao
-- adquirir o lock processandoTurno). O reaper de lock órfão filtra por esta coluna em vez
-- de iniciouEm (que é o início da EXECUÇÃO — numa conversa longa fica sempre >15min atrás
-- e o reaper resetaria o lock de uma conversa saudável, reabrindo o turno-em-dobro).
ALTER TABLE "FluxoExecucao" ADD COLUMN "turnoIniciadoEm" TIMESTAMP(3);
