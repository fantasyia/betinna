import type { JWTPayload } from 'jose';
import type { UserRole } from '@prisma/client';

/**
 * Claims do JWT emitido pelo Supabase Auth.
 *
 * Auditoria 2026-05-15 P0: empresaId e role NUNCA são lidos do body/query/headers.
 * Apenas do JWT verificado em `SupabaseAuthService.verifyToken`.
 *
 * - `sub` (UUID) → corresponde a `Usuario.id` no nosso banco
 * - `email` → preenchido pelo Supabase
 * - `role` → vem dos `app_metadata` configurado no Supabase (espelhado no DB)
 *
 * Notes:
 * - Como o Supabase emite JWT padrão sem `empresaId`/`role`, esses fields são
 *   buscados no DB via `AuthGuard.loadUser(sub)` e injetados em `request.user`.
 * - **NUNCA** assuma que claims além de `sub` estão no JWT — o resto vem do DB.
 */
export interface SupabaseJwtPayload extends JWTPayload {
  /** Required: subject (user id). */
  sub: string;
  /** Optional: email do user (Supabase preenche). */
  email?: string;
  /** Issuer. */
  iss?: string;
  /** Audience. */
  aud?: string | string[];
  /** Issued at (unix). */
  iat?: number;
  /** Expires at (unix). */
  exp?: number;
}

/**
 * Type guard pra confirmar que o payload tem `sub`.
 */
export function isValidJwtPayload(p: unknown): p is SupabaseJwtPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof (p as Record<string, unknown>).sub === 'string' &&
    ((p as Record<string, unknown>).sub as string).length > 0
  );
}

/**
 * Tipo dos dados de autenticação que vêm do request — definidos pelo `AuthGuard`
 * a partir do JWT verificado + `Usuario` carregado do DB. Reexporta `AuthenticatedUser`
 * com nota explícita sobre origem dos campos.
 *
 * REGRA: o `AuthenticatedUser.empresaIdAtiva` e `role` JAMAIS devem ser
 * preenchidos a partir de `req.body`, `req.query`, ou headers customizados.
 * O header `X-Empresa-Id` permite o user TROCAR de empresa entre as suas,
 * mas a lista de empresas válidas (`empresaIds`) sempre vem do DB.
 */
export type { AuthenticatedUser } from './authenticated-user';
