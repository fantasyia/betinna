-- REP passa a ENXERGAR os fluxos dele (os pessoais — o backend já filtra por dono).
--
-- Por que uma migration e não só mudar DEFAULT_PERMISSIONS: o seed do boot
-- (`seedMissingDefaults`) é CREATE-ONLY de propósito, pra não pisar em ajuste
-- que o admin fez na tela. A linha REP×fluxos já existia — semeada como
-- podeVer=false antes de fluxo pessoal existir —, então mudar o default no
-- código não teve efeito nenhum em quem já estava no ar. Corrigir o DADO é o
-- único caminho.
--
-- Vale pra TODO rep, inclusive os que ainda vão ser criados: `Permissao` é
-- global (unique [role, modulo], sem empresaId) — usuário novo não ganha linha
-- própria, ele lê esta.
--
-- `acoes` é a fonte da verdade quando preenchida (evita que podeEditar expanda
-- pra delete/approve). view+create+edit = o mesmo que DEFAULT_PERMISSIONS.REP.
UPDATE "Permissao"
SET "podeVer" = true,
    "podeEditar" = true,
    "acoes" = ARRAY['view', 'create', 'edit']
WHERE "role" = 'REP' AND "modulo" = 'fluxos';

-- Instalação nova que ainda não tenha a linha (o boot semeia, mas a migration
-- não pode depender da ordem): cria já correta, sem duplicar.
INSERT INTO "Permissao" ("id", "role", "modulo", "podeVer", "podeEditar", "acoes")
SELECT gen_random_uuid()::text, 'REP', 'fluxos', true, true, ARRAY['view', 'create', 'edit']
WHERE NOT EXISTS (
  SELECT 1 FROM "Permissao" WHERE "role" = 'REP' AND "modulo" = 'fluxos'
);
