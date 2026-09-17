-- UsuarioPermissao passa a ser POR EMPRESA (era o F-7 da auditoria de 14/09).
--
-- Antes: @@unique([usuarioId, modulo]) — sem empresa. Um override dado numa
-- empresa valia em TODAS as empresas daquele usuário. Liberar o financeiro pra
-- alguém aqui liberaria o financeiro de outro tenant junto, sem autorização.
--
-- Feito AGORA, em 17/09, porque a tabela está VAZIA (0 linhas, 5 usuários,
-- 1 empresa, sistema fora do ar). Depois do go-live seria mexer na chave única
-- de uma tabela de permissões com cliente sendo atendido — e cada linha
-- precisaria de um `empresaId` adivinhado exatamente no caso ambíguo que
-- motiva o conserto.
--
-- O backfill abaixo é cinto e suspensório: hoje ele não tem o que fazer, mas
-- cobre a linha que alguém crie entre esta escrita e o deploy.
ALTER TABLE "UsuarioPermissao" ADD COLUMN IF NOT EXISTS "empresaId" TEXT;

-- 1ª passada: usuário que pertence a UMA empresa — a resposta é ela, sem dúvida.
UPDATE "UsuarioPermissao" up
   SET "empresaId" = ue."empresaId"
  FROM "UsuarioEmpresa" ue
 WHERE ue."usuarioId" = up."usuarioId"
   AND up."empresaId" IS NULL
   AND (SELECT count(*) FROM "UsuarioEmpresa" x WHERE x."usuarioId" = up."usuarioId") = 1;

-- 2ª passada: usuário sem vínculo (ou com vários) quando existe UMA empresa no
-- sistema inteiro — também não há ambiguidade possível.
UPDATE "UsuarioPermissao"
   SET "empresaId" = (SELECT "id" FROM "Empresa" LIMIT 1)
 WHERE "empresaId" IS NULL
   AND (SELECT count(*) FROM "Empresa") = 1;

-- Sobrou nulo = ambiguidade real (usuário em N empresas, com N tenants). Aí o
-- NOT NULL abaixo FALHA de propósito: ninguém deve escolher por adivinhação em
-- que empresa uma permissão vale. Apagar a linha também não serve — override
-- pode ser NEGAÇÃO, e apagá-lo CONCEDE acesso em silêncio.
ALTER TABLE "UsuarioPermissao" ALTER COLUMN "empresaId" SET NOT NULL;

DROP INDEX IF EXISTS "UsuarioPermissao_usuarioId_modulo_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UsuarioPermissao_usuarioId_empresaId_modulo_key"
  ON "UsuarioPermissao" ("usuarioId", "empresaId", "modulo");
CREATE INDEX IF NOT EXISTS "UsuarioPermissao_empresaId_idx"
  ON "UsuarioPermissao" ("empresaId");

ALTER TABLE "UsuarioPermissao"
  DROP CONSTRAINT IF EXISTS "UsuarioPermissao_empresaId_fkey";
ALTER TABLE "UsuarioPermissao"
  ADD CONSTRAINT "UsuarioPermissao_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
