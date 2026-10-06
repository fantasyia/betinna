-- Vitrine: ponto da foto de capa escolhido pra bolinha da cor (null = automático).
ALTER TABLE "CatalogoModeloCor" ADD COLUMN IF NOT EXISTS "amostraX" DOUBLE PRECISION;
ALTER TABLE "CatalogoModeloCor" ADD COLUMN IF NOT EXISTS "amostraY" DOUBLE PRECISION;
