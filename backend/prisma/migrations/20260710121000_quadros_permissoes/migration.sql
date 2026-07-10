-- Semeia permissões do módulo 'quadros' (Kanban estilo Trello) por papel.
-- Idempotente e NÃO-destrutivo: ON CONFLICT DO NOTHING preserva customizações
-- feitas pelo admin na matriz. ADMIN não precisa de linha (bypass no guard).
INSERT INTO "Permissao" ("id", "role", "modulo", "podeVer", "podeEditar", "acoes")
VALUES
  (gen_random_uuid()::text, 'DIRECTOR', 'quadros', true, true, ARRAY['view','create','edit','approve','export']),
  (gen_random_uuid()::text, 'GERENTE',  'quadros', true, true, ARRAY['view','create','edit','approve','export']),
  (gen_random_uuid()::text, 'SAC',      'quadros', true, true, ARRAY['view','create','edit']),
  (gen_random_uuid()::text, 'REP',      'quadros', true, true, ARRAY['view','create','edit'])
ON CONFLICT ("role", "modulo") DO NOTHING;
