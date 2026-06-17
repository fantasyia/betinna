-- Migration: 2 FKs OBRIGATÓRIOS p/ Usuario — fecha o item 6.
-- RepCatalogoItem.usuarioId e RespostaRapida.criadoPorId são NOT NULL → não dá
-- SetNull; onDelete RESTRICT (default do Prisma p/ relação required). O DELETE
-- defensivo de órfãos roda ANTES do constraint: usuário nunca é hard-deleted no
-- app (só status INATIVO), então apaga 0 linhas na prática — mas garante que o
-- constraint não falhe nem com algum registro legado/manual solto.

DELETE FROM "RepCatalogoItem" WHERE "usuarioId" NOT IN (SELECT "id" FROM "Usuario");
ALTER TABLE "RepCatalogoItem" ADD CONSTRAINT "RepCatalogoItem_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DELETE FROM "RespostaRapida" WHERE "criadoPorId" NOT IN (SELECT "id" FROM "Usuario");
ALTER TABLE "RespostaRapida" ADD CONSTRAINT "RespostaRapida_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
