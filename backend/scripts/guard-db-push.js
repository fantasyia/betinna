#!/usr/bin/env node
/**
 * Guard contra `prisma db push`.
 *
 * `db push` aplica schema.prisma direto no banco SEM gerar migration.
 * Em produção isso causa drift entre `schema.prisma`, migrations e o banco
 * real — quem clonar o repo depois roda `migrate deploy` e quebra.
 *
 * Workflow correto: SEMPRE `prisma migrate dev --name <descr>` em dev,
 * commitar o diretório `prisma/migrations/<timestamp>_<descr>/`, e em
 * deploy rodar `prisma migrate deploy`.
 *
 * Pra os casos raros onde db push é legítimo (sandbox local descartável):
 *   npm run db:push:force
 *
 * Sprint 1 hardening (2026-05-16) — TD-A: migration baseline + guard.
 */

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

console.error(`
${RED}${BOLD}❌ db:push está bloqueado.${RESET}

Schema do banco DEVE evoluir por migrations versionadas, não por push direto.

${BOLD}Use:${RESET}
  ${YELLOW}npm run db:migrate -- --name <descricao_curta>${RESET}

Isso gera ${BOLD}prisma/migrations/<timestamp>_<descricao>/migration.sql${RESET}
que pode ser commitado e aplicado em produção via ${BOLD}prisma migrate deploy${RESET}.

Se tem CERTEZA que precisa do push (ex.: sandbox local descartável):
  ${YELLOW}npm run db:push:force${RESET}

⚠️  ${RED}NUNCA${RESET} rode db:push:force contra produção.

Mais contexto: backend/_audit/SPRINT1_HARDENING_2026-05-16.md (TD-A)
`);

process.exit(1);
