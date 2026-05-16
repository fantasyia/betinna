#!/usr/bin/env node
/**
 * Atualiza `prisma/migrations/.schema-hash` com a SHA-256 atual do schema.
 *
 * Roda ao final de `npm run db:migrate` (ou manualmente) pra fechar o ciclo
 * de drift detection.
 *
 * Sprint 1 hardening (2026-05-16) — TD-A.
 */

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'prisma', 'schema.prisma');
const hashPath = path.join(repoRoot, 'prisma', 'migrations', '.schema-hash');

if (!fs.existsSync(schemaPath)) {
  console.error(`schema.prisma não encontrado em ${schemaPath}`);
  process.exit(1);
}

const schemaContent = fs.readFileSync(schemaPath);
const hash = createHash('sha256').update(schemaContent).digest('hex');

fs.mkdirSync(path.dirname(hashPath), { recursive: true });
fs.writeFileSync(hashPath, hash + '\n', 'utf8');

console.log(`✓ schema-hash atualizado: ${hash.slice(0, 16)}…`);
console.log(`  arquivo: ${hashPath}`);
console.log(`  ${'-'.repeat(50)}`);
console.log(`  Commit ${path.relative(repoRoot, hashPath)} junto com a migration nova.`);
