-- Funil protegido/obrigatório: só ADMIN/DIRETOR edita/exclui; REP não mexe.
ALTER TABLE "Funil" ADD COLUMN "protegido" BOOLEAN NOT NULL DEFAULT false;
