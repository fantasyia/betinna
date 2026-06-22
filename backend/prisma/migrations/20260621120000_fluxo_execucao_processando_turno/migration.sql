-- Lock otimista do turno do nó Conversar com IA (anti turno/resposta/classificação em dobro).
ALTER TABLE "FluxoExecucao" ADD COLUMN "processandoTurno" BOOLEAN NOT NULL DEFAULT false;
