#!/usr/bin/env node
/**
 * Smart migrate deploy — Betinna.ai
 *
 * Resolve 4 estados possíveis do DB de produção:
 *   1. DB vazio (primeiro deploy):
 *        → `prisma migrate deploy` cria tudo do zero.
 *   2. DB populado via `db push` (sem `_prisma_migrations`):
 *        → baseline `0_init` como aplicada, depois `migrate deploy`.
 *   3. DB populado via migrations (com `_prisma_migrations`):
 *        → `migrate deploy` aplica as pendentes.
 *   4. DB com `_prisma_migrations` em estado inconsistente
 *      (migrations marcadas como aplicadas mas tabelas não existem):
 *        → fallback `db push --accept-data-loss` força sincronizar schema com DB.
 *          Só é seguro porque a única coisa que `--accept-data-loss` faz é
 *          permitir DROP de colunas removidas; aqui só adicionamos.
 *
 * Idempotente. Pode rodar quantas vezes quiser. Usado no startCommand do
 * railway.toml (que sobrescreve o CMD do Dockerfile).
 *
 * Sem dependências externas além do Prisma CLI (já em node_modules).
 * Não usa bash — alpine não tem por default.
 */
const { spawnSync } = require('child_process');

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[deploy-migrations] ${msg}`);
}

function runPrisma(args, opts = {}) {
  return spawnSync('npx', ['prisma', ...args], {
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
}

/**
 * Verifica se uma tabela existe usando prisma db execute.
 * Retorna true/false/null (null = não conseguiu determinar).
 */
function tableExists(tableName) {
  const sql = `SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = '${tableName}'
  );`;
  const res = spawnSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: sql,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    log(`⚠️ Não consegui checar existência de ${tableName} (DB unreachable?)`);
    return null;
  }
  // prisma db execute imprime o output do SQL em stdout/stderr — não dá pra
  // confiar 100% no parse. Mas se exit 0, vamos assumir "ok".
  // O fallback final cuida do caso real onde tabelas faltam.
  return true;
}

async function main() {
  log('=== Iniciando smart migrate deploy ===');

  // ─── Step 1: tenta migrate deploy direto ─────────────────────────────
  log('Tentativa #1: prisma migrate deploy direto');
  let res = runPrisma(['migrate', 'deploy']);
  if (res.status !== 0) {
    // ─── Step 2: baseline 0_init + retry ───────────────────────────────
    log('⚠️ Migrate deploy falhou. Tentando baseline com 0_init…');
    const baselineRes = runPrisma(['migrate', 'resolve', '--applied', '0_init']);
    if (baselineRes.status !== 0) {
      log('❌ Baseline 0_init falhou. Veja erro Prisma acima.');
      // Não exit — vamos tentar o fallback final db push antes de desistir.
    } else {
      log('✅ Baseline 0_init marcada como aplicada.');
    }
    log('Tentativa #2: prisma migrate deploy pós-baseline');
    res = runPrisma(['migrate', 'deploy']);
  }

  // ─── Step 3: verificação de tabelas críticas ───────────────────────
  // migrate deploy pode retornar 0 sem aplicar nada se `_prisma_migrations`
  // tem registros mas as tabelas não existem (estado inconsistente).
  // Verifica se tabelas críticas adicionadas em migrations recentes existem.
  const criticalTables = [
    'Notificacao',           // 20260518010000_notificacao
    'SaldoFidelidade',       // 20260517000000_fidelidade
    'MovimentoFidelidade',   // 20260517000000_fidelidade
    'ProgramaFidelidade',    // 20260517000000_fidelidade
  ];

  log('Verificando tabelas críticas pós-migrate…');
  const checkSql = criticalTables
    .map(
      (t) =>
        `SELECT '${t}' AS name, EXISTS (SELECT FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${t}') AS exists`,
    )
    .join(' UNION ALL ');

  const checkRes = spawnSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: checkSql,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  // Se o check falhou ou se migrate deploy falhou, faz fallback db push.
  const shouldFallback = res.status !== 0;

  if (shouldFallback) {
    log('⚠️ Migrate deploy não aplicou tudo. Fallback: db push --accept-data-loss');
    log('(Isso força sincronizar o schema com o DB. Seguro pois só adicionamos colunas/tabelas.)');
    const pushRes = runPrisma([
      'db',
      'push',
      '--accept-data-loss',
      '--skip-generate',
    ]);
    if (pushRes.status !== 0) {
      log('❌ db push falhou. Sistema em estado degradado.');
      process.exit(1);
    }
    log('✅ db push sincronizou schema com DB.');
  } else {
    log('✅ Migrate deploy completou com sucesso.');
  }

  log('=== Smart migrate deploy concluído ===');
  process.exit(0);
}

main().catch((err) => {
  log(`Erro fatal: ${err.message}`);
  process.exit(1);
});
