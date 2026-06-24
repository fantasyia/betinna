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
  // Sempre captura stderr também pra detectar erros transientes (P1001, etc.)
  // Usa 'pipe' pra stderr/stdout, mas ainda imprime no console pra visibilidade.
  const useInherit = !opts.silent && !opts.captureStderr;
  const res = spawnSync('npx', ['prisma', ...args], {
    stdio: useInherit ? 'inherit' : ['inherit', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  if (!useInherit) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
  return res;
}

/**
 * Detecta se o erro do Prisma é de **rede/conexão** (transiente) e não
 * de SQL/schema (permanente). Quando transiente, faz sentido deixar o
 * app subir mesmo assim — o Nest exporá `/health` (liveness), o healthcheck
 * do Railway passa, e queries começam a funcionar quando o DB voltar.
 *
 * Erros transientes conhecidos:
 *  - P1001: Can't reach database server
 *  - P1002: Database server timeout
 *  - P1008: Operations timed out
 *  - P1017: Server has closed the connection
 *  - ECONNREFUSED / ETIMEDOUT / ENOTFOUND (TCP layer)
 *
 * Padrão Bull/ioredis em produção: app sobe mesmo sem Redis disponível;
 * mesma filosofia aqui pra DB transiente.
 */
function isTransientNetworkError(prismaOutput) {
  if (!prismaOutput) return false;
  const text = String(prismaOutput);
  return (
    /P100[12]:/.test(text) || // P1001, P1002
    /P1008:/.test(text) ||
    /P1017:/.test(text) ||
    /Can't reach database server/i.test(text) ||
    /ECONNREFUSED/.test(text) ||
    /ETIMEDOUT/.test(text) ||
    /ENOTFOUND/.test(text)
  );
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
  let res = runPrisma(['migrate', 'deploy'], { captureStderr: true });

  // Fast-path: se DB inacessível (erro transiente de rede), NÃO trava o boot.
  // Deixa o app subir em estado degradado — healthcheck liveness `/health`
  // ainda responde e o Nest pode reconectar quando DB voltar. Sem isso,
  // qualquer outage transiente do Postgres derruba o container em loop.
  if (
    res.status !== 0 &&
    (isTransientNetworkError(res.stderr) || isTransientNetworkError(res.stdout))
  ) {
    log('⚠️ DB INACESSÍVEL (erro transiente de rede detectado).');
    log('⚠️ App vai subir em ESTADO DEGRADADO — queries vão falhar até DB voltar.');
    log('⚠️ Verifique o serviço Postgres no Railway dashboard.');
    log('=== Smart migrate deploy SKIPPED (DB unreachable) ===');
    process.exit(0); // soft success — deixa start.js prosseguir com node dist/main
  }

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
    res = runPrisma(['migrate', 'deploy'], { captureStderr: true });

    // Mesma proteção pós-baseline
    if (
      res.status !== 0 &&
      (isTransientNetworkError(res.stderr) || isTransientNetworkError(res.stdout))
    ) {
      log('⚠️ DB ainda inacessível pós-baseline. App vai subir degradado.');
      process.exit(0);
    }
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
    'FluxoStepClaim',        // idempotência do executor de fluxos
    'KnowledgeChunk',        // RAG (base de conhecimento + embeddings)
  ];

  log('Verificando tabelas críticas pós-migrate…');
  // Probe: um SELECT por tabela crítica. `prisma db execute` NÃO retorna linhas (não dá pra
  // ler EXISTS do stdout — era por isso que o check antigo era código morto). Mas ele retorna
  // status != 0 se QUALQUER statement falhar — e um SELECT numa tabela inexistente falha.
  // Assim detectamos o estado "migrate deploy retornou 0 mas as tabelas não existem".
  const checkSql = criticalTables.map((t) => `SELECT 1 FROM "${t}" LIMIT 1;`).join('\n');

  const checkRes = spawnSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: checkSql,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  // Tabela crítica ausente = schema incompleto → precisa de fallback. Ignora falha transiente
  // de rede no próprio check (aí não força db push à toa; o app sobe degradado e reconcilia depois).
  const checkTransiente =
    isTransientNetworkError(checkRes.stderr || '') || isTransientNetworkError(checkRes.stdout || '');
  const schemaIncompleto = checkRes.status !== 0 && !checkTransiente;
  if (schemaIncompleto) {
    log('⚠️ Tabela crítica AUSENTE — migrate deploy retornou 0 mas o schema está incompleto.');
  }

  // Fallback db push se migrate deploy falhou OU se o schema ficou incompleto.
  const shouldFallback = res.status !== 0 || schemaIncompleto;

  if (shouldFallback) {
    log('⚠️ Migrate deploy não aplicou tudo. Fallback: db push --accept-data-loss');
    log('(Reconcilia o schema completo com o DB — pode dropar/recriar índices, ex: o índice');
    log(' unique do MarketplaceIncident. NÃO é garantidamente aditivo; --accept-data-loss.)');
    const pushRes = runPrisma(
      ['db', 'push', '--accept-data-loss', '--skip-generate'],
      { captureStderr: true },
    );
    if (pushRes.status !== 0) {
      // Se db push falhou por DB inacessível, ainda assim deixa subir degradado.
      if (
        isTransientNetworkError(pushRes.stderr) ||
        isTransientNetworkError(pushRes.stdout)
      ) {
        log('⚠️ db push também falhou por DB inacessível. App sobe degradado.');
        process.exit(0);
      }
      log('❌ db push falhou por erro NÃO-transiente — schema DIVERGENTE. Abortando o deploy.');
      // FAIL LOUD: subir com schema divergente é pior que falhar o deploy (queries quebram
      // em runtime, silenciosamente). exit(1) → start.js detecta e o deploy do Railway falha,
      // mantendo a versão anterior no ar até o operador corrigir.
      process.exit(1);
    }
    log('✅ db push sincronizou schema com DB.');
  } else {
    log('✅ Migrate deploy completou com sucesso.');
  }

  log('=== Smart migrate deploy concluído ===');
  process.exit(0);
}

// Permite usar este script como entry: roda migrate + spawn do app correto
// baseado em SERVICE_TYPE env var. Quando chamado via `node scripts/deploy-migrations.js`
// sem args, comporta-se como antes (só migrate). Quando chamado como
// `node scripts/start.js` (alias), encadeia o app start.

main().catch((err) => {
  log(`Erro fatal: ${err.message}`);
  process.exit(1);
});
