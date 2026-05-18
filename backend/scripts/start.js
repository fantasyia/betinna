#!/usr/bin/env node
/**
 * Production start script — Betinna.ai.
 *
 * Fluxo:
 *  1. Roda smart migrate deploy (idempotente)
 *  2. Escolhe entry baseado em SERVICE_TYPE:
 *     - "worker" → node dist/worker.js (background processing, sem HTTP)
 *     - "api" ou default → node dist/main.js (HTTP API + healthcheck)
 *
 * Usado no railway.toml startCommand. Compartilhado por api e worker services.
 *
 * Por quê: o railway.toml startCommand sobrescreve as configs individuais de
 * cada service no dashboard, então precisamos de uma forma de diferenciar via env.
 */
const { spawnSync, spawn } = require('child_process');
const path = require('path');

const SERVICE_TYPE = (process.env.SERVICE_TYPE || 'api').toLowerCase();

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[start] ${msg}`);
}

// 1. Roda migrate (síncrono)
log('Rodando smart migrate deploy…');
const migrate = spawnSync(process.execPath, [path.join(__dirname, 'deploy-migrations.js')], {
  stdio: 'inherit',
});
if (migrate.status !== 0) {
  log(`❌ Migration falhou (exit ${migrate.status}). Abortando.`);
  process.exit(migrate.status ?? 1);
}

// 2. Escolhe entry point baseado em SERVICE_TYPE
const entry =
  SERVICE_TYPE === 'worker'
    ? path.join(process.cwd(), 'dist', 'worker.js')
    : path.join(process.cwd(), 'dist', 'main.js');

log(`SERVICE_TYPE=${SERVICE_TYPE} → executando ${entry}`);

// 3. Spawn do app — propaga sinais e exit code
const child = spawn(process.execPath, [entry], {
  stdio: 'inherit',
});

// Forward sinais pra graceful shutdown
['SIGTERM', 'SIGINT', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => {
    log(`Recebido ${sig}, propagando pro child…`);
    child.kill(sig);
  });
});

child.on('exit', (code, signal) => {
  if (signal) {
    log(`Child terminado por sinal ${signal}`);
    process.exit(0);
  } else {
    log(`Child saiu com code ${code}`);
    process.exit(code ?? 0);
  }
});
