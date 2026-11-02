-- Opcional de modelo (Léo, 02/11): "+ emblema emborrachado" vira escolha
-- dentro do modelo base na vitrine. Só colunas novas, nada destrutivo.
ALTER TABLE "CatalogoModelo" ADD COLUMN "opcionalDeId" TEXT;
ALTER TABLE "CatalogoModelo" ADD COLUMN "opcionalNome" VARCHAR(60);

ALTER TABLE "CatalogoModelo" ADD CONSTRAINT "CatalogoModelo_opcionalDeId_fkey"
  FOREIGN KEY ("opcionalDeId") REFERENCES "CatalogoModelo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
