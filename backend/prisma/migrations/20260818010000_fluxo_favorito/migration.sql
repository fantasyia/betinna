-- Favoritar fluxo.
--
-- Favorito é PESSOAL, não da empresa: o SAC vive na triagem, o diretor vive na
-- prospecção. Se fosse uma coluna booleana em "Fluxo", um marcaria e
-- desmarcaria o do outro. Daí a chave composta (usuário, fluxo).
CREATE TABLE IF NOT EXISTS "FluxoFavorito" (
  "usuarioId" TEXT NOT NULL,
  "fluxoId"   TEXT NOT NULL,
  "criadoEm"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FluxoFavorito_pkey" PRIMARY KEY ("usuarioId", "fluxoId")
);

-- Índice pelo fluxo: usado no cascade e em "quem favoritou este fluxo".
CREATE INDEX IF NOT EXISTS "FluxoFavorito_fluxoId_idx" ON "FluxoFavorito"("fluxoId");

-- Cascade nos dois lados: usuário desativado/removido ou fluxo excluído não
-- podem deixar favorito órfão apontando pra nada.
ALTER TABLE "FluxoFavorito"
  ADD CONSTRAINT "FluxoFavorito_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FluxoFavorito"
  ADD CONSTRAINT "FluxoFavorito_fluxoId_fkey"
  FOREIGN KEY ("fluxoId") REFERENCES "Fluxo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
