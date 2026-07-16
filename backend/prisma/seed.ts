/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { ACTIONS, DEFAULT_PERMISSIONS, MODULES } from '../src/modules/permissions/permissions.constants';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Seeding...\n');

  // ─── 1) Permissões padrão ─────────────────────────────────────────
  console.log('→ Aplicando matriz de permissões...');
  for (const role of Object.keys(DEFAULT_PERMISSIONS) as Array<keyof typeof DEFAULT_PERMISSIONS>) {
    const moduleMap = DEFAULT_PERMISSIONS[role];
    for (const m of MODULES) {
      const actions = moduleMap[m] ?? [];
      const podeVer = actions.includes('view');
      const podeEditar = actions.some((a: (typeof ACTIONS)[number]) => a !== 'view');
      await prisma.permissao.upsert({
        where: { role_modulo: { role, modulo: m } },
        update: { podeVer, podeEditar },
        create: { role, modulo: m, podeVer, podeEditar },
      });
    }
  }
  console.log(`  ✓ ${MODULES.length} módulos × 4 papéis = ${MODULES.length * 4} entradas`);

  // ─── 2) Empresa padrão (matriz) ───────────────────────────────────
  console.log('\n→ Criando empresa padrão...');
  const empresa = await prisma.empresa.upsert({
    where: { cnpj: '00.000.000/0001-00' },
    update: {},
    create: {
      nome: 'Indústria Alimentos',
      cnpj: '00.000.000/0001-00',
      ramo: 'Alimentos B2B',
      cidade: 'São Paulo',
      uf: 'SP',
      subtitulo: 'Matriz · Admin',
      ativo: true,
    },
  });
  console.log(`  ✓ Empresa: ${empresa.nome}`);

  // ─── 3) Usuário admin inicial via Supabase Auth ───────────────────
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@betinna.ai';
  // Senha NUNCA hardcoded no repo — obrigatória via env (backend/.env.local, gitignored).
  const ADMIN_PASS = process.env.SEED_ADMIN_PASSWORD;
  if (!ADMIN_PASS) {
    throw new Error('SEED_ADMIN_PASSWORD ausente — defina em backend/.env.local antes do seed');
  }
  const ADMIN_NOME = process.env.SEED_ADMIN_NOME ?? 'Diretor Betinna';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('\n⚠ Variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes — pulando criação do admin.');
  } else {
    console.log(`\n→ Criando admin inicial (${ADMIN_EMAIL})...`);
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let userId: string;
    const existing = await prisma.usuario.findUnique({ where: { email: ADMIN_EMAIL } });
    if (existing) {
      userId = existing.id;
      console.log(`  ✓ Admin já existe no Postgres (${userId})`);
    } else {
      // Verifica se o admin já existe no Supabase Auth — pode acontecer quando
      // alguém criou via dashboard manualmente OU o seed foi pelo meio
      // anteriormente (Supabase ok, Postgres falhou).
      let supabaseUserId: string | null = null;
      try {
        const { data: usersData } = await supabase.auth.admin.listUsers();
        const found = usersData?.users?.find((u) => u.email === ADMIN_EMAIL);
        if (found) {
          supabaseUserId = found.id;
          console.log(`  ✓ Admin já existe no Supabase Auth (${supabaseUserId}) — sincronizando com Postgres`);
        }
      } catch (err) {
        console.warn(`  ⚠ Não consegui listar users do Supabase: ${err instanceof Error ? err.message : err}`);
      }

      if (supabaseUserId) {
        userId = supabaseUserId;
      } else {
        const { data, error } = await supabase.auth.admin.createUser({
          email: ADMIN_EMAIL,
          password: ADMIN_PASS,
          email_confirm: true,
          user_metadata: { nome: ADMIN_NOME, role: 'ADMIN' },
        });
        if (error || !data.user) {
          console.error('  ✗ Falha ao criar admin no Supabase:', error?.message);
          throw error ?? new Error('Falha desconhecida');
        }
        userId = data.user.id;
        console.log(`  ✓ Admin criado no Supabase: ${ADMIN_EMAIL} / senha: ${ADMIN_PASS}`);
      }

      await prisma.usuario.create({
        data: {
          id: userId,
          email: ADMIN_EMAIL,
          nome: ADMIN_NOME,
          role: 'ADMIN',
          status: 'ATIVO',
          empresas: { create: { empresaId: empresa.id } },
        },
      });
      console.log(`  ✓ Admin sincronizado no Postgres (${userId})`);
    }
  }

  console.log('\n✅ Seed concluído.\n');
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
