-- Endereço próprio do produto na vitrine (/p/<slug>, card cmvkaagey, 23/10).
-- Só ADD + preenchimento dos modelos que já existem + índice único por empresa.
ALTER TABLE "CatalogoModelo" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- Slug a partir do nome (sem acento, minúsculo, hífen), igual ao slugDoNome do
-- código; repetido na mesma empresa ganha -2, -3… pela ordem de criação.
WITH base AS (
  SELECT
    id,
    "empresaId",
    "criadoEm",
    COALESCE(
      NULLIF(
        trim(BOTH '-' FROM regexp_replace(
          lower(translate(
            nome,
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
          )),
          '[^a-z0-9]+', '-', 'g'
        )),
        ''
      ),
      'produto'
    ) AS s
  FROM "CatalogoModelo"
  WHERE "slug" IS NULL
),
numerado AS (
  SELECT id, s, row_number() OVER (PARTITION BY "empresaId", s ORDER BY "criadoEm", id) AS n
  FROM base
)
UPDATE "CatalogoModelo" m
SET "slug" = CASE WHEN numerado.n = 1 THEN numerado.s ELSE numerado.s || '-' || numerado.n END
FROM numerado
WHERE m.id = numerado.id;

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoModelo_empresaId_slug_key" ON "CatalogoModelo"("empresaId", "slug");
