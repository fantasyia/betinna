import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  KanbanSquare,
  LayoutDashboard,
  BarChart3,
  ShoppingCart,
  Package,
  MessageSquare,
  CalendarDays,
  Briefcase,
  Settings,
  Inbox,
  Menu,
  ChevronRight,
  Search,
  Sun,
  Moon,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { clearSession } from '@/lib/auth-store';
import { useRole, usePermission, type ModuloName } from '@/hooks/usePermission';
import { getPermissoes, subscribePermissoes } from '@/lib/permissions-store';
import { useEmpresaLogo } from '@/hooks/useEmpresaLogo';
import { useBadges, type BadgeCounts } from '@/hooks/useBadges';
import { NotificationBell } from '@/components/NotificationBell';
import { EmpresaSwitcher } from '@/components/EmpresaSwitcher';
import { FavoritosBar } from '@/components/FavoritosBar';
import { Avatar } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

/**
 * PageLayout — design system v2 (dark, lucide icons, Linear-style).
 *
 * Sidebar fixa 240px desktop / drawer mobile. Nav agrupada por contexto.
 * Topbar com breadcrumb opcional, search global (placeholder), actions, sino.
 */

const MOBILE_BREAKPOINT = 768;

 
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Parameters<typeof usePermission>[0];
  /** Módulo do painel granular que controla a visibilidade desta aba (matriz viva). */
  modulo?: ModuloName;
  badge?: 'new' | 'beta';
  /** F5 — qual contador de novidade exibe o numerinho neste item. */
  badgeKey?: keyof BadgeCounts;
  /** Rotas filhas — usadas pra manter o item ativo quando o usuário está em
   * uma sub-aba (ex: /pedidos ativa 'Vendas', /comissoes também). */
  match?: string[];
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Navegação consolidada (Lote 9 / N1 — 2026-05-21):
 * 8 abas principais; cada uma abre sua tela default e dentro tem
 * sub-abas (componentes *Tabs em /components) com as opções relacionadas.
 *
 * Rotas default escolhidas pra ser acessíveis ao MAIOR número de papéis
 * possíveis — assim REP/SAC não cai em /403 ao clicar na aba principal.
 */
const SECTIONS: NavSection[] = [
  {
    items: [
      {
        to: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        modulo: 'dashboard',
      },
      {
        to: '/pedidos',
        label: 'Vendas',
        icon: ShoppingCart,
        modulo: 'pedidos',
        match: [
          '/aprovacoes',
          '/propostas',
          '/amostras',
          '/comissoes',
          '/metas',
          '/materiais',
          '/devolucoes',
        ],
        badgeKey: 'vendas',
      },
      {
        to: '/leads',
        label: 'CRM',
        icon: Briefcase,
        modulo: 'kanban',
        match: ['/clientes', '/funis', '/tags', '/segmentos', '/fluxos', '/campanhas'],
      },
      {
        to: '/kanban',
        label: 'Quadros',
        icon: KanbanSquare,
        modulo: 'quadros',
      },
      {
        to: '/agenda',
        label: 'Agenda',
        icon: CalendarDays,
        modulo: 'agenda',
      },
      {
        to: '/inbox',
        label: 'Atendimento',
        icon: MessageSquare,
        modulo: 'inbox',
        match: ['/ocorrencias', '/incidentes', '/whatsapp', '/mullerbot'],
        badgeKey: 'atendimento',
      },
      {
        to: '/produtos',
        label: 'Catálogo',
        icon: Package,
        modulo: 'catalogo',
        match: ['/catalogo'],
      },
      {
        to: '/inbox-interna',
        label: 'Mensagens',
        icon: Inbox,
      },
      {
        to: '/relatorios',
        label: 'Relatórios',
        icon: BarChart3,
        permission: 'relatorios.view',
        modulo: 'relatorios',
      },
      {
        to: '/perfil',
        label: 'Sistema',
        icon: Settings,
        match: [
          '/usuarios',
          '/configuracoes',
          '/admin',
          '/permissoes',
          '/integracoes',
          '/minhas-integracoes',
        ],
      },
    ],
  },
];

const SIDEBAR_WIDTH = 240;

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  DIRECTOR: 'Diretor',
  GERENTE: 'Gerente',
  SAC: 'SAC',
  REP: 'Representante',
};

// ─── Sidebar logo (com fallback do logo da empresa) ─────────────────────

function SidebarLogo({ role }: { role: string | null }) {
  const { logoUrl } = useEmpresaLogo();
  return (
    <div className="flex items-center justify-between gap-2 px-3.5 py-3 border-b border-border">
      <div className="flex items-center gap-2 min-w-0">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Logo da empresa"
            className="h-8 w-8 shrink-0 object-contain rounded-[4px]"
            draggable={false}
            onError={(e) => {
              // Fallback se logo falhar — esconde img, mostra Betinna
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <img
            src="/betinna-symbol.svg"
            alt="Betinna.ai"
            className="h-8 w-8 shrink-0"
            draggable={false}
          />
        )}
        <div className="flex flex-col min-w-0">
          <strong
            className="text-base font-extrabold leading-tight tracking-tight text-text"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Betinna<span className="text-magenta">.ai</span>
          </strong>
          <span className="text-[10px] text-muted leading-tight uppercase tracking-wider">
            {role ? ROLE_LABEL[role] ?? role : 'Sem sessão'}
          </span>
        </div>
      </div>
      <ThemeToggle />
    </div>
  );
}

// ─── Sidebar nav item ────────────────────────────────────────────────

function SidebarNavItem({
  item,
  active,
  count = 0,
}: {
  item: NavItem;
  active: boolean;
  count?: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      data-testid={`nav-${item.to.replace('/', '')}`}
      className={cn(
        'group relative flex items-center gap-2.5 px-2.5 py-1.5 my-px rounded-md text-sm font-medium',
        'transition-all duration-100',
        'whitespace-nowrap overflow-hidden text-ellipsis',
        active
          ? 'bg-primary/10 text-primary font-semibold shadow-[inset_3px_0_0_0_var(--primary)]'
          : 'text-text-subtle hover:bg-primary/5 hover:text-primary',
      )}
    >
      <Icon
        className={cn(
          'shrink-0 h-[15px] w-[15px]',
          active ? 'text-primary' : 'text-muted group-hover:text-primary',
        )}
        strokeWidth={active ? 2.5 : 2}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {/* F5 — badge numérico de novidade (pedidos pra aprovar, msgs no inbox…) */}
      {count > 0 && (
        <span
          data-testid={`nav-badge-${item.to.replace('/', '')}`}
          className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold tabular leading-none"
          aria-label={`${count} novidade${count === 1 ? '' : 's'}`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {item.badge && (
        <span
          className={cn(
            'px-1.5 py-px rounded-sm text-[9px] font-bold uppercase tracking-wide',
            item.badge === 'new' && 'bg-primary/15 text-primary',
            item.badge === 'beta' && 'bg-info/15 text-info',
          )}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────

function Sidebar({
  isMobile,
  isOpen,
  onClose,
}: {
  isMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
}) {
  const role = useRole();
  const location = useLocation();
  const badges = useBadges();

  const perms = {
    'clientes.view': usePermission('clientes.view'),
    'whatsapp.pessoal': usePermission('whatsapp.pessoal'),
    'admin.panel': usePermission('admin.panel'),
    'relatorios.view': usePermission('relatorios.view'),
    'campanhas.view': usePermission('campanhas.view'),
  } as const;

  // Matriz VIVA do painel granular — aba some na hora quando o admin tira o "Ver".
  const matriz = useSyncExternalStore(subscribePermissoes, getPermissoes, getPermissoes);

  function canSee(item: NavItem): boolean {
    if (item.permission && !perms[item.permission as keyof typeof perms]) return false;
    if (item.modulo && role !== 'ADMIN' && matriz) {
      return matriz.get(item.modulo)?.ver ?? false;
    }
    return true;
  }

  function isActive(item: NavItem): boolean {
    const path = location.pathname;
    if (path === item.to) return true;
    if (path.startsWith(item.to + '/')) return true;
    if (item.match?.some((m) => path === m || path.startsWith(m + '/'))) {
      return true;
    }
    return false;
  }

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'fixed top-0 left-0 bottom-0 z-50',
        'flex flex-col bg-bg-alt border-r border-border',
        isMobile ? 'transition-transform duration-200 ease-out' : '',
      )}
      style={{
        width: SIDEBAR_WIDTH,
        transform: isMobile && !isOpen ? 'translateX(-100%)' : 'translateX(0)',
        zIndex: isMobile ? 100 : 50,
      }}
      onClick={(e) => {
        if (isMobile && (e.target as HTMLElement).closest('a')) onClose();
      }}
    >
      {/* Logo oficial (ou logo da empresa quando configurado) + dark mode toggle */}
      <SidebarLogo role={role} />

      {/* Multi-tenant: trocar empresa ativa (ADMIN vê todas; demais só vinculadas) */}
      <EmpresaSwitcher />

      {/* Quick search (placeholder pra futuro cmdk) */}
      <div className="px-3 py-2.5 border-b border-border">
        <div
          className={cn(
            'flex items-center gap-2 h-7 px-2 rounded',
            'bg-surface border border-border text-muted text-xs',
            'cursor-pointer hover:bg-surface-hover hover:border-border-strong transition-colors',
          )}
          title="Buscar (em breve)"
        >
          <Search className="h-3 w-3" />
          <span className="flex-1">Buscar…</span>
          <kbd className="text-[10px] font-mono text-muted-light bg-bg px-1 rounded border border-border">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Nav scrollable */}
      <nav className="flex-1 overflow-y-auto px-2 py-2.5">
        {SECTIONS.map((section, idx) => {
          const visibleItems = section.items.filter(canSee);
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.title ?? `section-${idx}`} className="mb-3">
              {section.title && (
                <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-light">
                  {section.title}
                </div>
              )}
              {visibleItems.map((item) => (
                <SidebarNavItem
                  key={item.to}
                  item={item}
                  active={isActive(item)}
                  count={item.badgeKey ? badges[item.badgeKey] : 0}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {/* User card no rodapé */}
      <Link
        to="/perfil"
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 border-t border-border',
          'hover:bg-surface-hover transition-colors group',
        )}
      >
        <Avatar name={role ?? '—'} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text truncate">
            {role ? ROLE_LABEL[role] ?? role : 'Sem sessão'}
          </div>
          <div className="text-[11px] text-muted truncate">Ver perfil</div>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>

      {/* Botão de sair (logout) */}
      <button
        type="button"
        data-testid="logout-btn"
        onClick={() => {
          clearSession();
          // Volta pra tela de login (a sessão já foi limpa).
          window.location.assign('/login');
        }}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 w-full text-left',
          'text-sm text-muted hover:text-danger hover:bg-surface-hover transition-colors',
        )}
      >
        <LogOut className="h-3.5 w-3.5" />
        Sair
      </button>
    </aside>
  );
}

// ─── Mobile top bar ─────────────────────────────────────────────────

// ─── Theme toggle ──────────────────────────────────────────────

function ThemeToggle() {
  const [theme, , toggle] = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Trocar para light mode' : 'Trocar para dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md shrink-0',
        'border border-border bg-surface text-text-subtle',
        'hover:bg-primary/10 hover:text-primary hover:border-primary/40',
        'transition-colors',
      )}
    >
      {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </button>
  );
}

function MobileTopBar({
  title,
  onToggleSidebar,
}: {
  title: string;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 px-3 py-2.5 bg-bg-alt border-b border-border min-h-[52px]">
      <button
        type="button"
        data-testid="mobile-menu-toggle"
        onClick={onToggleSidebar}
        aria-label="Abrir menu"
        className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-surface text-text hover:bg-surface-hover transition-colors"
      >
        <Menu className="h-4 w-4" />
      </button>
      <strong
        data-testid="mobile-page-title"
        className="flex-1 min-w-0 truncate text-sm font-semibold text-text tracking-tight"
      >
        {title}
      </strong>
      <NotificationBell />
    </header>
  );
}

function MobileBackdrop({ onClick }: { onClick: () => void }) {
  return (
    <div
      data-testid="mobile-sidebar-backdrop"
      onClick={onClick}
      className="fixed inset-0 z-[90] bg-black/60"
      style={{ backdropFilter: 'blur(2px)' }}
    />
  );
}

// ─── PageLayout principal ────────────────────────────────────────────

export function PageLayout({
  title,
  description,
  actions,
  actionsBelow = false,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * Força as ações numa linha PRÓPRIA abaixo do título/descrição (alinhadas à
   * esquerda), em vez do topo-direita. Padroniza o cabeçalho independente do
   * tamanho da descrição (senão descrições longas empurram os botões pra baixo
   * e curtas os deixam no topo — inconsistente entre telas). Usado nos Quadros.
   */
  actionsBelow?: boolean;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (isMobile && sidebarOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isMobile, sidebarOpen]);

  return (
    <div className="bg-bg min-h-screen text-text">
      <Sidebar isMobile={isMobile} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {isMobile && sidebarOpen && <MobileBackdrop onClick={() => setSidebarOpen(false)} />}
      {isMobile && <MobileTopBar title={title} onToggleSidebar={() => setSidebarOpen((v) => !v)} />}
      <main
        id="main-content"
        style={{ marginLeft: isMobile ? 0 : SIDEBAR_WIDTH }}
        className={cn(
          isMobile ? 'px-4 pb-10 pt-4' : 'px-8 pt-7 pb-12',
          'min-h-screen',
        )}
        // a11y: focus-visible permite ao usuário pular pra cá via skip-to-content
        tabIndex={-1}
      >
        {!isMobile && (
          <header
            className={cn(
              'mb-7',
              actionsBelow
                ? 'flex flex-col gap-3'
                : 'flex items-start justify-between gap-4 flex-wrap',
            )}
          >
            <div className="flex flex-col gap-1 min-w-0">
              <h1
                data-testid="page-title"
                className="text-2xl font-bold tracking-tight text-text"
              >
                {title}
              </h1>
              {description && (
                <p className="text-sm text-text-subtle">{description}</p>
              )}
            </div>
            <div className={cn('flex items-center gap-2 flex-wrap', !actionsBelow && 'shrink-0')}>
              {actions}
              <NotificationBell />
            </div>
          </header>
        )}
        {isMobile && actions && (
          <div className="flex items-center gap-2 flex-wrap mb-4">{actions}</div>
        )}
        <FavoritosBar />
        {children}
      </main>
    </div>
  );
}

// Re-export pra eslint react-refresh rule (mantém compat com hooks acima)
export { Menu as _MenuIcon };
