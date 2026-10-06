-- Vitrine: foto por cor × LINHA (Regular / Plus Size / Infantil mostram o
-- biotipo certo). linhaId null = foto geral da cor (todas as fotos de hoje).
-- Só ADICIONA coluna, FK e índice — nada destrutivo.
ALTER TABLE "CatalogoFoto" ADD COLUMN IF NOT EXISTS "linhaId" TEXT;

DO $$ BEGIN
  ALTER TABLE "CatalogoFoto"
    ADD CONSTRAINT "CatalogoFoto_linhaId_fkey" FOREIGN KEY ("linhaId")
    REFERENCES "CatalogoLinha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "CatalogoFoto_modeloCorId_linhaId_ordem_idx"
  ON "CatalogoFoto"("modeloCorId", "linhaId", "ordem");
