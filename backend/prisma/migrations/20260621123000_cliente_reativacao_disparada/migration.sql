-- Marca de "gatilho de reativação (CLIENTE_INATIVO_30D) já disparado" — anti re-disparo/spam.
ALTER TABLE "Cliente" ADD COLUMN "reativacaoDisparadaEm" TIMESTAMP(3);
