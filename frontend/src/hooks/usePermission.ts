/**
 * usePermission — Sprint 4 FIX 6.
 *
 * Hook centralizado para checagem de RBAC no frontend.
 *
 * Regras (alinhadas com `CLAUDE.md`):
 *  - ADMIN: acesso global a tudo
 *  - DIRECTOR: acesso completo dentro da sua empresa
 *  - GERENTE: gestão operacional sem config/integrações
 *  - SAC: atendimento (Inbox + ocorrências)
 *  - REP: apenas a própria carteira
 *
 * Role vem do JWT em MEMÓRIA — nunca de localStorage.
 *
 * Uso:
 *   const canSeeFidelidade = usePermission('fidelidade.view');
 *   const canBulkAssign = usePermission('clientes.bulkAssign');
 */
import { useSyncExternalStore } from 'react';
import type { UserRole } from '@/types/auth';
import { getSession, subscribe } from '@/lib/auth-store';

/**
 * Catálogo central de permissões.
 * Adicione aqui quando criar novos módulos sensíveis.
 *
 * Convenção: `modulo.acao` — case sensitive.
 */
export type Permission =
  // Fidelidade (módulo restrito DIRETOR per CLAUDE.md)
  | 'fidelidade.view'
  | 'fidelidade.edit'
  // MullerBot config — só DIRETOR
  | 'mullerbot.config'
  // Clientes
  | 'clientes.view'
  | 'clientes.edit'
  | 'clientes.bulkAssign'
  // Admin
  | 'admin.panel'
  | 'admin.users'
  | 'admin.deadLetter'
  // Comissões
  | 'comissoes.team' // ver equipe (gerente)
  | 'comissoes.own' // ver próprias (rep)
  | 'comissoes.all' // ver todos (admin/director)
  // Integrações / WhatsApp
  | 'whatsapp.empresa'
  | 'whatsapp.pessoal'
  // Relatórios
  | 'relatorios.view'
  | 'relatorios.export';

/**
 * Matriz role × permission.
 * Adicionar role → permission aqui (single source of truth pro frontend).
 *
 * IMPORTANTE: o backend SEMPRE valida via PermissionsGuard. Esta tabela
 * é APENAS pra hide UI — não confie nela para gates de segurança.
 */
const PERMISSION_MATRIX: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    'fidelidade.view',
    'fidelidade.edit',
    'mullerbot.config',
    'clientes.view',
    'clientes.edit',
    'clientes.bulkAssign',
    'admin.panel',
    'admin.users',
    'admin.deadLetter',
    'comissoes.all',
    'whatsapp.empresa',
    'whatsapp.pessoal',
    'relatorios.view',
    'relatorios.export',
  ]),
  DIRECTOR: new Set<Permission>([
    'fidelidade.view',
    'fidelidade.edit',
    'mullerbot.config',
    'clientes.view',
    'clientes.edit',
    'clientes.bulkAssign',
    'comissoes.all',
    'whatsapp.empresa',
    'whatsapp.pessoal',
    'relatorios.view',
    'relatorios.export',
  ]),
  GERENTE: new Set<Permission>([
    'clientes.view',
    'clientes.edit',
    'clientes.bulkAssign',
    'comissoes.team',
    'whatsapp.pessoal',
    'relatorios.view',
  ]),
  SAC: new Set<Permission>([
    'clientes.view',
    'whatsapp.empresa',
    'relatorios.view',
  ]),
  REP: new Set<Permission>([
    'clientes.view',
    'comissoes.own',
    'whatsapp.pessoal',
  ]),
};

/**
 * Subscribe ao auth store via useSyncExternalStore (concurrent-safe).
 */
function subscribeAuth(callback: () => void): () => void {
  return subscribe(() => callback());
}

function getSnapshot() {
  return getSession();
}

/**
 * Retorna `true` se o user atual tem a permissão indicada.
 * Reactivo — re-renderiza quando role muda.
 */
export function usePermission(permission: Permission): boolean {
  const session = useSyncExternalStore(subscribeAuth, getSnapshot, getSnapshot);
  const role = session?.user?.role;
  if (!role) return false;
  return PERMISSION_MATRIX[role].has(permission);
}

/**
 * Helper síncrono (fora de componente) — útil em route guards.
 */
export function hasPermission(role: UserRole | null, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSION_MATRIX[role].has(permission);
}

/**
 * Hook para o role atual (com reatividade).
 * Retorna null se não autenticado.
 */
export function useRole(): UserRole | null {
  const session = useSyncExternalStore(subscribeAuth, getSnapshot, getSnapshot);
  return session?.user?.role ?? null;
}
