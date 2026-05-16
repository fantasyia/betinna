/**
 * Tipos de autenticação compartilhados com o backend (alinhar com
 * `backend/src/shared/types/authenticated-user.ts`).
 */

export type UserRole = 'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP';

export interface AuthenticatedUser {
  id: string;
  email: string;
  nome: string;
  role: UserRole;
  empresaIds: string[];
  empresaIdAtiva: string | null;
}

/**
 * Sessão de autenticação no frontend.
 * JWT access token vive APENAS em memória (state) — nunca em localStorage.
 * Refresh token vem do Supabase via cookie httpOnly (gerenciado pelo Supabase SDK).
 */
export interface AuthSession {
  accessToken: string;
  user: AuthenticatedUser;
  /** Unix ms — quando o access token expira */
  expiresAt: number;
}
