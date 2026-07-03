-- Override de permissão POR USUÁRIO (coarse ver/editar).
-- Linha presente (usuarioId, modulo) SUBSTITUI a permissão do papel naquele módulo;
-- sem linha → vale a matriz do papel (Permissao).
CREATE TABLE "UsuarioPermissao" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "podeVer" BOOLEAN NOT NULL DEFAULT true,
    "podeEditar" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsuarioPermissao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsuarioPermissao_usuarioId_modulo_key" ON "UsuarioPermissao"("usuarioId", "modulo");

CREATE INDEX "UsuarioPermissao_usuarioId_idx" ON "UsuarioPermissao"("usuarioId");

ALTER TABLE "UsuarioPermissao" ADD CONSTRAINT "UsuarioPermissao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
