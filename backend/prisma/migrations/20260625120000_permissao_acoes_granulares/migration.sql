-- Ações granulares na Permissao (raiz do #6 da re-auditoria): antes só havia podeVer/podeEditar
-- e podeEditar expandia para create+edit+delete+approve+export, concedendo delete/approve a
-- papéis que a matriz nega (REP/SAC). Coluna nullable-vazia por default → linhas legadas caem
-- no expand coarse (compat); applyDefaults passa a gravar a granularidade real.
ALTER TABLE "Permissao" ADD COLUMN "acoes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
