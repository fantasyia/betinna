import type { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  /** ID do usuário (mesmo ID do Supabase Auth) */
  id: string;
  email: string;
  nome: string;
  role: UserRole;
  /** IDs das empresas que o usuário pode acessar */
  empresaIds: string[];
  /** Empresa ativa na requisição corrente (definida pelo header X-Empresa-Id ou pela primeira) */
  empresaIdAtiva: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Preenchido pelo SupabaseAuthGuard */
    user?: AuthenticatedUser;
    /** UUID único da requisição, usado em logs e auditoria */
    id?: string;
  }
}
