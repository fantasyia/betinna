#!/usr/bin/env node
/**
 * Guard do `prisma migrate dev`.
 *
 * `backend/.env.local` aponta o DATABASE_URL pro Postgres de PRODUÇÃO (Railway)
 * — não existe banco de desenvolvimento neste projeto. `migrate dev` é comando
 * de dev: ele detecta drift e OFERECE RESETAR o banco. Rodar isso contra prod
 * apaga a base inteira.
 *
 * Só libera quando o DATABASE_URL é comprovadamente local.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return null;
  const linha = fs
    .readFileSync(envPath, 'utf-8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('DATABASE_URL='));
  if (!linha) return null;
  return linha.slice(linha.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

const url = lerDatabaseUrl();
const ehLocal = !!url && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

if (!ehLocal) {
  const host = url ? (url.match(/@([^:/?]+)/)?.[1] ?? '?') : '(não encontrado)';
  console.error(`
${RED}${BOLD}❌ db:migrate (prisma migrate dev) está bloqueado.${RESET}

O DATABASE_URL aponta pra ${BOLD}${host}${RESET} — não é localhost.
Neste projeto o .env.local aponta pro banco de ${RED}${BOLD}PRODUÇÃO${RESET}, e
${BOLD}migrate dev pode RESETAR o banco${RESET} quando detecta drift.

${BOLD}Fluxo correto pra criar migration:${RESET}
  1. escreva ${YELLOW}prisma/migrations/<timestamp>_<nome>/migration.sql${RESET} à mão
  2. ${YELLOW}npm run db:update-hash${RESET}
  3. commit — o deploy aplica no startup (scripts/deploy-migrations.js)

Índice fora do schema.prisma (unique parcial, índice de expressão) vai TAMBÉM
em ${YELLOW}prisma/sql/objetos-invisiveis.sql${RESET}, senão o fallback db push apaga.
`);
  process.exit(1);
}

// Banco local de verdade — segue o fluxo normal.
const args = process.argv.slice(2);
const r = spawnSync('npx', ['prisma', 'migrate', 'dev', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (r.status !== 0) process.exit(r.status ?? 1);
spawnSync('node', [path.join(__dirname, 'update-schema-hash.js')], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
