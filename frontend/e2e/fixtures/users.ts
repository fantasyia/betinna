/**
 * Usuários de teste (criados pelo seed-test.ts no Supabase local).
 * Senha única: ver SEED_TEST_PASSWORD no backend/.env.test.
 */
export const TEST_PASSWORD = 'Teste@2026';

export type TestUser = { email: string; role: string; empresa: 'A' | 'B' | 'AB' };

export const USERS = {
  admin: { email: 'admin@betinna.test', role: 'ADMIN', empresa: 'AB' },
  diretorA: { email: 'diretor.a@betinna.test', role: 'DIRECTOR', empresa: 'A' },
  gerenteA: { email: 'gerente.a@betinna.test', role: 'GERENTE', empresa: 'A' },
  repA1: { email: 'rep.a1@betinna.test', role: 'REP', empresa: 'A' },
  repA2: { email: 'rep.a2@betinna.test', role: 'REP', empresa: 'A' },
  diretorB: { email: 'diretor.b@betinna.test', role: 'DIRECTOR', empresa: 'B' },
  gerenteB: { email: 'gerente.b@betinna.test', role: 'GERENTE', empresa: 'B' },
  repB1: { email: 'rep.b1@betinna.test', role: 'REP', empresa: 'B' },
  repB2: { email: 'rep.b2@betinna.test', role: 'REP', empresa: 'B' },
} satisfies Record<string, TestUser>;
