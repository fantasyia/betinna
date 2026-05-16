#!/usr/bin/env node
/**
 * Migration drift check (lightweight — sem shadow DB).
 *
 * Compara a SHA-256 atual de `schema.prisma` contra a SHA registrada quando
 * a última migration foi gerada (`prisma/migrations/.schema-hash`).
 *
 * Workflow:
 *  - Dev altera schema.prisma → roda `npm run db:migrate -- --name X`
 *  - O script `db:migrate` deve rodar `update-schema-hash` ao final
 *  - CI roda `db:check-drift` antes do build — falha se hashes divergem
 *
 * Por que não usar `prisma migrate diff`? Diff exige shadow DB; check de hash
 * funciona sem dependência de Postgres rodando.
 *
 * Sprint 1 hardening (2026-05-16) — TD-A: migration drift detection.
 */

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'prisma', 'schema.prisma');
const hashPath = path.join(repoRoot, 'prisma', 'migrations', '.schema-hash');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

if (!fs.existsSync(schemaPath)) {
  console.error(`${RED}schema.prisma não encontrado em ${schemaPath}${RESET}`);
  process.exit(1);
}

const schemaContent = fs.readFileSync(schemaPath);
const currentHash = sha256(schemaContent);

if (!fs.existsSync(hashPath)) {
  console.error(`${YELLOW}${BOLD}⚠️  ${hashPath} não existe.${RESET}

Provavelmente é a primeira execução. Para registrar o hash atual:
  ${YELLOW}npm run db:update-hash${RESET}

Se o schema realmente já está sincronizado com a última migration commitada,
basta gerar o arquivo de hash agora.
`);
  process.exit(2);
}

const storedHash = fs.readFileSync(hashPath, 'utf8').trim();

if (currentHash === storedHash) {
  console.log(`${GREEN}✓ Sem drift — schema.prisma matches a última migration registrada.${RESET}`);
  process.exit(0);
}

console.error(`${RED}${BOLD}❌ Drift detectado em schema.prisma!${RESET}

Hash atual:    ${currentHash}
Hash esperado: ${storedHash}

Há mudanças em ${BOLD}prisma/schema.prisma${RESET} que ainda não viraram migration.

${BOLD}Para corrigir:${RESET}
  ${YELLOW}npm run db:migrate -- --name <descricao_curta>${RESET}

Isso vai gerar a migration faltante. Commitar o resultado.

Se vc TEM CERTEZA que o schema já está em sync (ex.: ajuste cosmético sem
impacto no DB), pode regenerar o hash:
  ${YELLOW}npm run db:update-hash${RESET}

⚠️  ${RED}Não use db:push:force${RESET} — quebra reprodutibilidade do deploy.
`);
process.exit(2);
