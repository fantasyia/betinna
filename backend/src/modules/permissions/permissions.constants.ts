import type { UserRole } from '@prisma/client';

/**
 * Catálogo de módulos do sistema (usado na matriz de permissões).
 * Manter alinhado com a lista de páginas no frontend.
 */
export const MODULES = [
  'dashboard',
  'kanban',
  'quadros', // Kanban estilo Trello (boards/listas/cards) — 'kanban' é o pipeline de leads
  'clientes',
  'pedidos',
  'propostas',
  'fluxos',
  'campanhas',
  'inbox',
  'marketplace',
  'ocorrencias',
  'reps',
  'catalogo',
  'comissoes',
  'amostras',
  'metas',
  'relatorios',
  'config',
  'aprovacoes',
  'agenda',
  'integracoes',
  'audit_log',
] as const;

export type ModuleName = (typeof MODULES)[number];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
export type ActionName = (typeof ACTIONS)[number];

/**
 * Matriz padrão de permissões por papel.
 * É carregada em `Permissao` table pelo seed na primeira execução.
 * Admin/Diretor podem ajustar depois via UI de permissões.
 *
 * ADMIN não está aqui — Admin tem acesso total via short-circuit no guard.
 */
type PermissionMatrix = Record<UserRole, Partial<Record<ModuleName, ActionName[]>>>;

export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  ADMIN: {}, // bypass total no PermissionsGuard

  // Diretor: acesso total ao operacional
  DIRECTOR: Object.fromEntries(
    MODULES.map((m) => [m, ['view', 'create', 'edit', 'approve', 'export'] as ActionName[]]),
  ) as Partial<Record<ModuleName, ActionName[]>>,

  GERENTE: Object.fromEntries(
    MODULES.filter((m) => m !== 'config' && m !== 'integracoes' && m !== 'audit_log').map((m) => [
      m,
      // 'approve' permite ao gerente decidir aprovações de desconto
      ['view', 'create', 'edit', 'approve', 'export'] as ActionName[],
    ]),
  ) as Partial<Record<ModuleName, ActionName[]>>,

  /**
   * SAC = equipe interna de atendimento. Default focado em SAC marketplaces
   * + ocorrências + visualização de clientes/pedidos pra contexto.
   * Diretor/Admin podem expandir essas permissões via UI de configurações
   * (Role × Módulo × Ação) conforme necessidade do time.
   */
  SAC: {
    dashboard: ['view'],
    quadros: ['view', 'create', 'edit'],
    inbox: ['view', 'edit'],
    marketplace: ['view', 'edit'],
    ocorrencias: ['view', 'create', 'edit'],
    clientes: ['view'],
    pedidos: ['view'],
    agenda: ['view', 'create', 'edit'],
  },

  /**
   * REP = representante comercial. Foco em vender pra clientes da carteira.
   *
   * Acessa Inbox SOMENTE pra WhatsApp dos clientes da carteira (filtro
   * automático no service). NÃO acessa marketplace SAC (ML/Shopee/Amazon/
   * TikTok) nem redes sociais (IG/FB) — esses são responsabilidade da
   * equipe interna SAC.
   */
  REP: {
    dashboard: ['view'],
    kanban: ['view', 'create', 'edit'],
    quadros: ['view', 'create', 'edit'], // máx 1 board (regra no service)
    clientes: ['view', 'edit'],
    pedidos: ['view', 'create', 'edit'],
    propostas: ['view', 'create', 'edit'],
    aprovacoes: ['view'], // rep vê apenas as próprias solicitações
    inbox: ['view', 'edit'], // só WhatsApp + clientes da carteira (enforced no service)
    ocorrencias: ['view', 'create'],
    catalogo: ['view', 'create', 'edit'],
    comissoes: ['view'],
    amostras: ['view', 'create'],
    metas: ['view'],
    agenda: ['view', 'create', 'edit', 'delete'],
    config: ['view', 'edit'], // só pra editar dados próprios + integrações de usuário
  },
};
