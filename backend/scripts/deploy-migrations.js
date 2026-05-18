#!/usr/bin/env node
/**
 * Smart migrate deploy — Betinna.ai
 *
 * Resolve 3 estados possíveis do DB de produção:
 *   1. DB vazio (primeiro deploy):
 *        → `prisma migrate deploy` cria tudo do zero
 *   2. DB populado via `db push` (sem `_prisma_migrations`):
 *        → baseline `0_init` como aplicada, depois `migrate deploy`
 *   3. DB populado via migrations (com `_prisma_migrations`):
 *        → `migrate deploy` aplica as pendentes
 *
 * Idempotente: pode rodar quantas vezes quiser. Usado no CMD do Dockerfile.
 *
 * Sem dependências externas além do que já vem no node_modules
 * (Prisma CLI). Não usa bash — alpine não tem por default.
 */
const { execSync, spawnSync } = require('child_process');

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[deploy-migrations] ${msg}`);
}

function runPrisma(args, opts = {}) {
  const res = spawnSync('npx', ['prisma', ...args], {
    stdio: opts.captureOutput ? 'pipe' : 'inherit',
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  return res;
}

function tableExists(tableName) {
  // Usa prisma db execute com SQL pra checar existência da tabela.
  // Retorna true/false sem lançar.
  const sql = `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${tableName}' LIMIT 1;`;
  const res = spawnSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: sql,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  // prisma db execute retorna 0 em sucesso. Se falhar (DB unreachable etc), retorna != 0.
  // O comando NÃO retorna não-zero se a tabela não existe — o SELECT só retorna 0 rows.
  // Pra checar de fato, precisamos parsear a saída — mas isso varia por versão.
  //
  // Estratégia alternativa: tentamos uma operação que falha SOMENTE se a tabela existe.
  // Mais simples: usamos `prisma db execute` com um query informativo e checamos exit.
  // Se o script falhar (DB issue), o caller decide.
  return res.status === 0;
}

async function main() {
  log('Iniciando smart migrate deploy…');

  // Step 1: tenta migrate deploy direto. Cobre cenários 1 e 3.
  log('Tentativa #1: prisma migrate deploy direto');
  let res = runPrisma(['migrate', 'deploy']);
  if (res.status === 0) {
    log('✅ Migrate deploy aplicou tudo limpo.');
    process.exit(0);
  }

  // Step 2: falhou. Provável cenário 2 (DB via db push). Tenta baseline.
  log('⚠️  Migrate deploy falhou. Tentando baseline com 0_init…');
  // `migrate resolve --applied` é idempotente: se já aplicado, é no-op.
  // Cria _prisma_migrations se não existir.
  res = runPrisma(['migrate', 'resolve', '--applied', '0_init']);
  if (res.status !== 0) {
    log('❌ Baseline falhou também. Veja erro Prisma acima.');
    process.exit(1);
  }
  log('✅ Baseline 0_init marcada como aplicada.');

  // Step 3: agora migrate deploy aplica só as pendentes (pós-0_init)
  log('Tentativa #2: prisma migrate deploy pós-baseline');
  res = runPrisma(['migrate', 'deploy']);
  if (res.status === 0) {
    log('✅ Migrations pendentes aplicadas.');
    process.exit(0);
  }

  log('❌ Migrate deploy continuou falhando após baseline. Drift no schema?');
  process.exit(1);
}

main().catch((err) => {
  log(`Erro fatal: ${err.message}`);
  process.exit(1);
});
