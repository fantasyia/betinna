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
 *   const canSeeRelatorios = usePermission('relatorios.view');
 *   const canBulkAssign = usePermission('clientes.bulkAssign');
 */
import { useSyncExternalStore } from 'react';
import type { UserRole } from '@/types/auth';
import { getSession, subscribe } from '@/lib/auth-store';
import {
  getPermissoes,
  subscribePermissoes,
  type ModuloPerm,
} from '@/lib/permissions-store';

/**
 * Catálogo central de permissões.
 * Adicione aqui quando criar novos módulos sensíveis.
 *
 * Convenção: `modulo.acao` — case sensitive.
 */
export type Permission =
  // MullerBot config — só DIRECTOR/ADMIN
  | 'mullerbot.config'
  // MullerBot auditoria — ADMIN, DIRECTOR, GERENTE
  | 'mullerbot.auditoria'
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
  | 'relatorios.export'
  // Campanhas (marketing)
  | 'campanhas.view'
  | 'campanhas.create'
  | 'campanhas.edit'
  | 'campanhas.delete'
  // Rotas de módulo (unificação de gate)
  | 'incidentes.view'       // ADMIN, DIRECTOR, GERENTE, SAC
  | 'configuracoes.view'    // ADMIN
  | 'configuracoes.empresa' // ADMIN, DIRECTOR — listar/editar empresas (config multi-tenant)
  | 'permissoes.view'       // ADMIN
  | 'usuarios.view'         // ADMIN, DIRECTOR, GERENTE
  | 'fluxos.view'           // ADMIN, DIRECTOR, GERENTE
  | 'fluxos.edit'           // ADMIN, DIRECTOR — criar/editar/excluir fluxos
  | 'funis.view'            // ADMIN, DIRECTOR, GERENTE
  | 'segmentos.view'        // ADMIN, DIRECTOR, GERENTE
  | 'integracoes.view'      // ADMIN, DIRECTOR, GERENTE
  // Ações gated inline (checks em componentes/páginas)
  | 'aprovacoes.decide'     // ADMIN, DIRECTOR — aprovar/rejeitar descontos e cancelamentos
  | 'campanhas.manage'      // ADMIN, DIRECTOR, GERENTE — disparar/pausar/cancelar campanhas
  | 'comissoes.manage'      // ADMIN, DIRECTOR — fechar mês / marcar pago
  | 'inbox.zerar';          // ADMIN, DIRECTOR, GERENTE, SAC — zerar conversa (reset bot)

/**
 * Matriz role × permission.
 * Adicionar role → permission aqui (single source of truth pro frontend).
 *
 * IMPORTANTE: o backend SEMPRE valida via PermissionsGuard. Esta tabela
 * é APENAS pra hide UI — não confie nela para gates de segurança.
 */
const PERMISSION_MATRIX: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    'mullerbot.config',
    'mullerbot.auditoria',
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
    'campanhas.view',
    'campanhas.create',
    'campanhas.edit',
    'campanhas.delete',
    'incidentes.view',
    'configuracoes.view',
    'configuracoes.empresa',
    'permissoes.view',
    'usuarios.view',
    'fluxos.view',
    'fluxos.edit',
    'funis.view',
    'segmentos.view',
    'integracoes.view',
    'aprovacoes.decide',
    'campanhas.manage',
    'comissoes.manage',
    'inbox.zerar',
  ]),
  DIRECTOR: new Set<Permission>([
    'mullerbot.config',
    'mullerbot.auditoria',
    'clientes.view',
    'clientes.edit',
    'clientes.bulkAssign',
    'comissoes.all',
    'comissoes.manage',
    'whatsapp.empresa',
    'whatsapp.pessoal',
    'relatorios.view',
    'relatorios.export',
    'campanhas.view',
    'campanhas.create',
    'campanhas.edit',
    'campanhas.delete',
    'campanhas.manage',
    'incidentes.view',
    'configuracoes.empresa',
    'usuarios.view',
    'fluxos.view',
    'fluxos.edit',
    'funis.view',
    'segmentos.view',
    'integracoes.view',
    'aprovacoes.decide',
    'inbox.zerar',
  ]),
  GERENTE: new Set<Permission>([
    'mullerbot.auditoria',
    'clientes.view',
    'clientes.edit',
    'clientes.bulkAssign',
    'comissoes.team',
    'whatsapp.pessoal',
    'relatorios.view',
    'campanhas.view',
    'campanhas.create',
    'campanhas.edit',
    'campanhas.manage',
    'incidentes.view',
    'usuarios.view',
    'fluxos.view',
    'funis.view',
    'segmentos.view',
    'integracoes.view',
    'inbox.zerar',
  ]),
  SAC: new Set<Permission>([
    'clientes.view',
    'whatsapp.empresa',
    'relatorios.view',
    'incidentes.view',
    // SAC gerencia os atendimentos do Inbox → pode zerar uma conversa (reset da thread).
    'inbox.zerar',
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

// ─── Permissões DINÂMICAS por módulo (matriz viva do banco) ─────────────────
//
// Complementam a PERMISSION_MATRIX fixa acima: a fixa cobre ações finas de UI
// (ex.: campanhas.manage); a dinâmica cobre VISIBILIDADE de módulo e obedece o
// painel "Permissões granulares" + overrides por usuário, em tempo quase-real.

/** Módulos do backend (permissions.constants.ts) — manter alinhado. */
export type ModuloName =
  | 'dashboard'
  | 'kanban'
  | 'quadros' // Kanban estilo Trello (boards) — 'kanban' é o pipeline de leads
  | 'clientes'
  | 'pedidos'
  | 'propostas'
  | 'fluxos'
  | 'campanhas'
  | 'inbox'
  | 'marketplace'
  | 'ocorrencias'
  | 'reps'
  | 'catalogo'
  | 'comissoes'
  | 'amostras'
  | 'metas'
  | 'relatorios'
  | 'config'
  | 'aprovacoes'
  | 'agenda'
  | 'integracoes'
  | 'audit_log';

/**
 * Mapa prefixo-de-rota → módulo. Usado pelo ProtectedRoute (deriva o módulo do
 * pathname — sub-rotas herdam pelo prefixo) e pelo sidebar/sub-abas.
 * Rotas de sistema (perfil, usuários, admin, notificações…) ficam FORA de
 * propósito — são gated por role/permission fixa, não pelo painel granular.
 */
export const ROUTE_MODULO: ReadonlyArray<readonly [prefix: string, modulo: ModuloName]> = [
  ['/dashboard', 'dashboard'],
  ['/kanban', 'quadros'],
  ['/calendario-marketing', 'quadros'],
  ['/leads', 'kanban'],
  ['/funis', 'kanban'],
  ['/segmentos', 'kanban'],
  ['/tags', 'kanban'],
  ['/clientes', 'clientes'],
  ['/contatos', 'clientes'],
  ['/pedidos', 'pedidos'],
  ['/devolucoes', 'pedidos'],
  ['/propostas', 'propostas'],
  ['/fluxos', 'fluxos'],
  ['/campanhas', 'campanhas'],
  ['/inbox', 'inbox'],
  ['/respostas-rapidas', 'inbox'],
  ['/ocorrencias', 'ocorrencias'],
  ['/incidentes', 'ocorrencias'],
  ['/produtos', 'catalogo'],
  ['/catalogo', 'catalogo'],
  ['/materiais', 'catalogo'],
  ['/comissoes', 'comissoes'],
  ['/amostras', 'amostras'],
  ['/metas', 'metas'],
  ['/relatorios', 'relatorios'],
  ['/agenda', 'agenda'],
  ['/aprovacoes', 'aprovacoes'],
  ['/integracoes', 'integracoes'],
  // '/whatsapp' fica FORA: tem gate fino próprio (whatsapp.empresa) que inclui
  // SAC — mapear pra 'integracoes' (DIRECTOR-only por padrão) regrediria o SAC.
] as const;

/** Resolve o módulo de um pathname (ou null se rota sem módulo mapeado). */
export function moduloDaRota(pathname: string): ModuloName | null {
  // '/inbox-interna' não pode casar com o prefixo '/inbox' — exige fim ou '/'.
  for (const [prefix, modulo] of ROUTE_MODULO) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return modulo;
  }
  return null;
}

function getPermSnapshot() {
  return getPermissoes();
}

/**
 * Permissão dinâmica do módulo pro usuário logado.
 * Enquanto a matriz não carregou → fail-open (ver/editar true): o backend
 * continua sendo o gate real e a UI não pisca durante o load.
 * ADMIN sempre true (o backend já devolve tudo true, mas o curto-circuito
 * protege contra matriz vazia).
 */
export function useModulo(modulo: ModuloName | null): ModuloPerm {
  const matriz = useSyncExternalStore(subscribePermissoes, getPermSnapshot, getPermSnapshot);
  const session = useSyncExternalStore(subscribeAuth, getSnapshot, getSnapshot);
  if (!modulo) return { ver: true, editar: true };
  if (session?.user?.role === 'ADMIN') return { ver: true, editar: true };
  if (!matriz) return { ver: true, editar: true };
  return matriz.get(modulo) ?? { ver: false, editar: false };
}
