import { createHash, randomBytes } from 'node:crypto';

/**
 * Token de API do Kanban (pro MCP server / Claude Code).
 *
 * Formato: `bkt_<43 chars base64url>` (~47 chars, spec pede 40+).
 * O prefixo permite ao AuthGuard distinguir de um JWT Supabase sem
 * round-trip. NUNCA persistimos o valor — só o sha256 hex.
 */
export const KANBAN_TOKEN_PREFIX = 'bkt_';

export function gerarKanbanToken(): string {
  return KANBAN_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashKanbanToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
