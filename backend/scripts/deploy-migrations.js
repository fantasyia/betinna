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

const NL = String.fromCharCode(10);

function log(msg) {
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
 * Reaplica os objetos que o Prisma não conhece (índices só-SQL) — o
 * `db push` os REMOVE ao reconciliar o schema, com exit 0 e log de sucesso.
 * Entre eles estão os dois UNIQUE parciais que protegem o upsert da Inbox
 * contra corrida. Todos os statements são idempotentes.
 */
/**
 * Reaplica (e CONFERE) os objetos que só existem em SQL.
 *
 * ⚠️ POR QUE VIA PRISMA CLIENT E NÃO `npx prisma db execute`:
 *
 * Em 2026-08-11, com a rotina de "reaplica sempre + confere nome a nome" JÁ em
 * produção, os dois índices HNSW continuavam AUSENTES depois do deploy — e os
 * mesmos statements, rodados contra o MESMO banco de produção pelo Prisma
 * Client, funcionaram de primeira. Ou seja: o problema não era o SQL nem
 * permissão; era o caminho `npx prisma db execute --stdin` dentro do container.
 * Ele também é cego por natureza: `db execute` não devolve linhas nem mensagem
 * de erro útil, o que obrigava aquele truque de `DO $$ ... RAISE EXCEPTION` só
 * pra descobrir se um índice existia.
 *
 * Com o Client: o erro real aparece no log do deploy, a conferência é um SELECT
 * de verdade, e não dependemos do CLI resolver dentro do container.
 */
async function reaplicarObjetosInvisiveis() {
  const fs = require('fs');
  const path = require('path');
  const arquivo = path.join(__dirname, '..', 'prisma', 'sql', 'objetos-invisiveis.sql');
  if (!fs.existsSync(arquivo)) {
    log(`⚠️ ${arquivo} não encontrado — índices só-SQL NÃO foram reaplicados.`);
    return false;
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (err) {
    log(`⚠️ @prisma/client indisponível no deploy (${err.message}) — objetos só-SQL NÃO reaplicados.`);
    return false;
  }

  const arquivoTexto = fs.readFileSync(arquivo, 'utf-8');
  // UM statement por vez: um índice problemático não pode levar junto os UNIQUE
  // parciais da Inbox, que são o que mais importa aqui.
  const statements = arquivoTexto
    .split(';')
    .map((st) =>
      st
        .split(NL)
        .filter((l) => !l.trim().startsWith('--'))
        .join(NL)
        .trim(),
    )
    .filter(Boolean);

  const prisma = new PrismaClient();
  let falhas = 0;
  let ausentes = [];
  try {
    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (err) {
        falhas += 1;
        // A mensagem REAL do Postgres — era exatamente isto que faltava.
        log(`⚠️ Falhou: ${stmt.slice(0, 80).replace(/\s+/g, ' ')}… → ${err.message.split(NL)[0]}`);
      }
    }

    // CONFERÊNCIA PÓS-APLICAÇÃO: rodar sem erro NÃO prova que o objeto existe.
    const esperados = [
      ...arquivoTexto.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "([^"]+)"/g),
    ].map((m) => m[1]);
    const presentes = await prisma.$queryRawUnsafe(
      `SELECT relname FROM pg_class WHERE relkind = 'i' AND relname = ANY($1::text[])`,
      esperados,
    );
    const nomesPresentes = new Set(presentes.map((r) => r.relname));
    ausentes = esperados.filter((nome) => !nomesPresentes.has(nome));

    if (falhas === 0 && ausentes.length === 0) {
      log(
        `✅ ${esperados.length} índices só-SQL conferidos (unique parciais da Inbox, sufixo de telefone, HNSW).`,
      );
      return true;
    }
    if (falhas > 0) log(`⚠️ ${falhas}/${statements.length} statement(s) só-SQL falharam.`);
    // Nome a nome: sem isto o problema fica invisível e ninguém sabe O QUÊ falta.
    if (ausentes.length > 0) log(`⚠️ Objetos AUSENTES depois da reaplicação: ${ausentes.join(', ')}`);
    return false;
  } catch (err) {
    log(`⚠️ Reaplicação dos objetos só-SQL falhou: ${err.message.split(NL)[0]}`);
    return false;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

/**
 * Descobre QUAIS tabelas críticas estão ausentes — nome a nome.
 *
 * Retorna:
 *   { ausentes: [] }             → todas presentes
 *   { ausentes: ['X', 'Y'] }     → schema incompleto, COM os nomes
 *   { ausentes: null, motivo }   → INDETERMINADO (DB fora, probe quebrado).
 *                                  Indeterminado ≠ incompleto: quem chama NÃO
 *                                  pode disparar o fallback destrutivo às cegas.
 *
 * ⚠️ Por que via Prisma Client e não `npx prisma db execute` — a mesma lição já
 * documentada em reaplicarObjetosInvisiveis(), agora com um segundo caso:
 *
 * O probe antigo mandava UM script com os 6 SELECTs e chamava o CLI SEM `--url`
 * e SEM `--schema`. O `db execute` EXIGE um dos dois, então ele abortava com
 * "Either --url or --schema must be provided" e exit 1 ANTES de abrir conexão —
 * sempre, com qualquer banco. Como stdout/stderr eram capturados e descartados,
 * o log só dizia "⚠️ Tabela crítica AUSENTE", sem nome e sem a mensagem real.
 *
 * Efeito medido em produção (deploys de 13/09 e 15/09/2026, linhas idênticas):
 * `db push --accept-data-loss` rodava em TODO boot de api e worker, com as 6
 * tabelas presentes e `migrate deploy` reportando "No pending migrations".
 *
 * Com o Client o probe devolve LINHAS: dá pra dizer o nome do que falta.
 */
async function tabelasCriticasAusentes(tabelas) {
  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (err) {
    log(`⚠️ @prisma/client indisponível (${err.message.split(NL)[0]}) — probe via CLI.`);
    return probeTabelasViaCli(tabelas);
  }

  const prisma = new PrismaClient();
  try {
    const presentes = await prisma.$queryRawUnsafe(
      // `::text` de propósito: table_name é o domínio `sql_identifier`, e domínio
      // tem OID próprio — o driver pode não saber desserializar. Texto puro sempre sabe.
      `SELECT table_name::text AS table_name FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])`,
      tabelas,
    );
    const nomes = new Set(presentes.map((r) => r.table_name));
    return { ausentes: tabelas.filter((t) => !nomes.has(t)) };
  } catch (err) {
    // Falha do PROBE não é prova de tabela faltando — inclusive DB fora do ar.
    return { ausentes: null, motivo: String(err.message || err).split(NL)[0] };
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

/**
 * Plano B do probe: um `db execute` POR TABELA — assim o exit != 0 aponta a
 * tabela, em vez de condenar as seis de uma vez. Agora com `--schema`, sem o
 * qual o CLI nem conecta. A mensagem do Postgres vai pro log.
 */
function probeTabelasViaCli(tabelas) {
  const path = require('path');
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const ausentes = [];
  for (const tabela of tabelas) {
    const res = spawnSync(
      'npx',
      ['prisma', 'db', 'execute', '--schema', schemaPath, '--stdin'],
      {
        input: `SELECT 1 FROM "${tabela}" LIMIT 1;`,
        encoding: 'utf-8',
        shell: process.platform === 'win32',
      },
    );
    if (res.status === 0) continue;
    const saida = `${res.stdout || ''}${res.stderr || ''}`;
    if (isTransientNetworkError(saida)) {
      return { ausentes: null, motivo: `DB inacessível ao checar ${tabela}` };
    }
    const detalhe = saida.trim().split(NL).filter(Boolean).pop() || 'sem mensagem';
    log(`   ↳ ${tabela}: ${detalhe}`);
    ausentes.push(tabela);
  }
  return { ausentes };
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
  const probe = await tabelasCriticasAusentes(criticalTables);

  // Tabela crítica ausente = schema incompleto → precisa de fallback. Probe que não
  // conseguiu responder NÃO conta (aí não força db push à toa; o app sobe e reconcilia
  // depois) — mesma política que já valia pra falha transiente de rede no check.
  const schemaIncompleto = Array.isArray(probe.ausentes) && probe.ausentes.length > 0;
  if (schemaIncompleto) {
    log(
      `⚠️ Tabela(s) crítica(s) AUSENTE(S): ${probe.ausentes.join(', ')} — ` +
        'migrate deploy retornou 0 mas o schema está incompleto.',
    );
  } else if (probe.ausentes === null) {
    log(`⚠️ Não consegui verificar as tabelas críticas: ${probe.motivo}`);
    log('⚠️ Seguindo SEM forçar db push — indeterminado não é o mesmo que incompleto.');
  } else {
    log(`✅ ${criticalTables.length} tabelas críticas presentes.`);
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

  // Objetos só-SQL: reaplica SEMPRE, não só depois do fallback.
  //
  // Antes isto vivia DENTRO do `if (shouldFallback)`, e o raciocínio parecia
  // certo ("só o db push dropa índice"). Mas ele deixava o sistema sem
  // convergência: uma vez que um objeto sumisse — por um db push antigo, por um
  // drop manual, ou por um statement que falhou naquele boot — nada nunca mais o
  // recriava, porque o caminho feliz (migrate deploy OK) pulava a reaplicação.
  //
  // Foi o que aconteceu em produção: os dois índices HNSW (Produto e
  // KnowledgeChunk) estavam AUSENTES em 2026-08-09, com a extensão vector
  // instalada e as colunas vector(1536) no lugar — ou seja, a busca semântica do
  // RAG rodando em seq scan, sem erro nenhum, desde algum deploy antigo.
  //
  // Todos os statements são idempotentes (IF NOT EXISTS), então rodar sempre é
  // barato e faz o schema CONVERGIR a cada boot em vez de depender de um branch.
  if (!(await reaplicarObjetosInvisiveis())) {
    log('⚠️ ATENÇÃO: o app vai subir SEM parte dos índices só-SQL.');
    log('⚠️ Reaplique à mão: prisma db execute --file prisma/sql/objetos-invisiveis.sql');
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
