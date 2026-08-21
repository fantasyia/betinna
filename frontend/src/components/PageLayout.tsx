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
  CalendarRange,
  Briefcase,
  Settings,
  Inbox,
  Bot,
  Menu,
  ChevronRight,
  Sun,
  Moon,
  LogOut,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
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
  /** Esconde de papéis específicos, INDEPENDENTE da matriz de permissões.
   *  Pra quando o módulo é compartilhado mas a tela não é do trabalho daquele
   *  papel (ex: Calendário de Marketing usa o módulo `quadros`, que o rep tem
   *  pro quadro de tarefas dele — mas planejar campanha não é trabalho dele). */
  ocultarPara?: string[];
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
        to: '/calendario-marketing',
        label: 'Calendário Mkt',
        icon: CalendarRange,
        modulo: 'quadros',
        // O módulo `quadros` existe pro rep por causa do quadro de tarefas
        // dele; o calendário de marketing veio de carona. Planejamento de
        // campanha não é trabalho de representante.
        ocultarPara: ['REP'],
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
        // `/mullerbot` saiu daqui: o Assistente IA virou item próprio do menu
        // (abaixo). Se ficasse no match, os dois acendiam juntos na sidebar.
        match: ['/ocorrencias', '/incidentes', '/whatsapp'],
        badgeKey: 'atendimento',
      },
      {
        to: '/mullerbot',
        label: 'Assistente IA',
        icon: Bot,
        match: ['/mullerbot/persona', '/mullerbot/conhecimento', '/mullerbot/auditoria'],
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
/**
 * Sidebar recolhida: só os ícones. 60px é o menor valor que ainda deixa o ícone
 * (15px) centrado com área de clique confortável — abaixo disso o alvo fica
 * menor que o mínimo de toque e o item vira uma isca de erro.
 */
const SIDEBAR_WIDTH_RECOLHIDA = 60;
const SIDEBAR_RECOLHIDA_KEY = 'sidebar-recolhida-v1';

/**
 * Preferência de menu recolhido — por DISPOSITIVO (localStorage), igual à ordem
 * dos itens. Quem usa notebook pequeno recolhe lá e mantém aberto no monitor
 * grande, sem um mexer no outro.
 *
 * Só vale no desktop: no mobile a sidebar já é uma gaveta que abre e fecha
 * inteira, e uma tira de ícones fixa comeria a largura da tela.
 */
function useSidebarRecolhida(ativo: boolean): [boolean, () => void] {
  const [recolhida, setRecolhida] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_RECOLHIDA_KEY) === '1';
    } catch {
      return false;
    }
  });
  const alternar = () =>
    setRecolhida((v) => {
      const nova = !v;
      try {
        localStorage.setItem(SIDEBAR_RECOLHIDA_KEY, nova ? '1' : '0');
      } catch {
        // localStorage cheio/bloqueado não pode impedir de recolher o menu.
      }
      return nova;
    });
  return [ativo && recolhida, alternar];
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  DIRECTOR: 'Diretor',
  GERENTE: 'Gerente',
  SAC: 'SAC',
  REP: 'Representante',
};

// ─── Sidebar logo (com fallback do logo da empresa) ─────────────────────

function SidebarLogo({
  role,
  recolhida,
  onAlternar,
}: {
  role: string | null;
  recolhida: boolean;
  onAlternar?: () => void;
}) {
  const { logoUrl } = useEmpresaLogo();

  // Recolhida: só o símbolo, e ele VIRA o botão de expandir. Um ícone de logo
  // que não faz nada, numa tira de 60px, seria o único elemento morto da coluna.
  if (recolhida) {
    return (
      <div className="flex flex-col items-center gap-1 px-1 py-3 border-b border-border">
        <button
          type="button"
          onClick={onAlternar}
          data-testid="sidebar-expandir"
          aria-label="Expandir menu"
          aria-expanded={false}
          title="Expandir menu"
          className="group relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-primary/8 transition-colors"
        >
          <img
            src={logoUrl || '/betinna-symbol.svg'}
            alt="Betinna.ai"
            className="h-7 w-7 object-contain group-hover:opacity-0 transition-opacity"
            draggable={false}
          />
          <PanelLeftOpen className="absolute h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <ThemeToggle />
      </div>
    );
  }

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
      <div className="flex items-center gap-0.5 shrink-0">
        <ThemeToggle />
        {onAlternar && (
          <button
            type="button"
            onClick={onAlternar}
            data-testid="sidebar-recolher"
            aria-label="Recolher menu"
            aria-expanded
            title="Recolher menu"
            className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-primary/8 transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar nav item ────────────────────────────────────────────────

function SidebarNavItem({
  item,
  active,
  count = 0,
  recolhida = false,
}: {
  item: NavItem;
  active: boolean;
  count?: number;
  recolhida?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      data-testid={`nav-${item.to.replace('/', '')}`}
      // Recolhida, o rótulo some da tela — então ele PRECISA existir como nome
      // acessível, senão o leitor de tela anuncia só "link" e o mouse não tem
      // como descobrir o que é sem clicar.
      title={recolhida ? (count > 0 ? `${item.label} (${count})` : item.label) : undefined}
      aria-label={recolhida ? item.label : undefined}
      className={cn(
        'group relative flex items-center py-1.5 my-px rounded-md text-sm font-medium',
        'transition-all duration-100',
        'whitespace-nowrap overflow-hidden text-ellipsis',
        recolhida ? 'justify-center px-0' : 'gap-2.5 px-2.5',
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
      {/* Recolhida: o número não cabe, mas SUMIR com ele esconderia novidade
          (pedido pra aprovar, mensagem no inbox). Vira um ponto — perde a
          contagem, mantém o "tem coisa aqui". O total segue no title. */}
      {recolhida && count > 0 && (
        <span
          data-testid={`nav-dot-${item.to.replace('/', '')}`}
          className="absolute top-1 right-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-bg-alt"
          aria-label={`${count} novidade${count === 1 ? '' : 's'}`}
        />
      )}
      {!recolhida && <span className="flex-1 truncate">{item.label}</span>}
      {/* F5 — badge numérico de novidade (pedidos pra aprovar, msgs no inbox…) */}
      {!recolhida && count > 0 && (
        <span
          data-testid={`nav-badge-${item.to.replace('/', '')}`}
          className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold tabular leading-none"
          aria-label={`${count} novidade${count === 1 ? '' : 's'}`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {!recolhida && item.badge && (
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

// ─── Item reordenável (arrasta pelo "punho") ─────────────────────────
const SIDEBAR_ORDER_KEY = 'sidebar-nav-order-v1';

function SortableNavItem({
  item,
  active,
  count,
  recolhida = false,
}: {
  item: NavItem;
  active: boolean;
  count: number;
  recolhida?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.to,
  });
  const style = {
    transform: transform ? `translate3d(0px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('group/nav flex items-center', isDragging && 'opacity-70 z-10 relative')}
    >
      {/* Recolhida não tem punho: 60px não comportam ícone + punho sem espremer
          o alvo de clique. Reordenar continua existindo — é só expandir. */}
      {!recolhida && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Arrastar para reordenar"
          title="Arrastar para reordenar"
          className="shrink-0 cursor-grab touch-none px-0.5 text-muted-light opacity-0 group-hover/nav:opacity-100 focus:opacity-100"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <SidebarNavItem item={item} active={active} count={count} recolhida={recolhida} />
      </div>
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────

function Sidebar({
  isMobile,
  isOpen,
  onClose,
  recolhida,
  onAlternarRecolhida,
}: {
  isMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
  recolhida: boolean;
  onAlternarRecolhida: () => void;
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
    if (item.ocultarPara && role && item.ocultarPara.includes(role)) return false;
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

  // Ordem customizada da sidebar (drag-and-drop, persistida por dispositivo).
  const [ordem, setOrdem] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_ORDER_KEY);
      return Array.isArray(JSON.parse(raw ?? '')) ? (JSON.parse(raw as string) as string[]) : [];
    } catch {
      return [];
    }
  });
  // KeyboardSensor: o punho de reordenar é focável — Enter/Espaço pega, setas movem.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Itens visíveis (por papel/permissão), na ordem salva; novos itens vão pro fim.
  const todos = SECTIONS.flatMap((s) => s.items);
  const posOrdem = (to: string) => {
    const i = ordem.indexOf(to);
    return i === -1 ? 1000 + todos.findIndex((t) => t.to === to) : i;
  };
  const visiveis = [...todos].filter(canSee).sort((a, b) => posOrdem(a.to) - posOrdem(b.to));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const de = visiveis.findIndex((i) => i.to === active.id);
    const para = visiveis.findIndex((i) => i.to === over.id);
    if (de < 0 || para < 0) return;
    const nova = arrayMove(visiveis, de, para).map((i) => i.to);
    setOrdem(nova);
    localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(nova));
  }

  return (
    <aside
      data-testid="sidebar"
      data-recolhida={recolhida ? 'sim' : 'nao'}
      className={cn(
        'fixed top-0 left-0 bottom-0 z-50',
        'flex flex-col bg-bg-alt border-r border-border',
        isMobile ? 'transition-transform duration-200 ease-out' : 'transition-[width] duration-150',
      )}
      style={{
        width: recolhida ? SIDEBAR_WIDTH_RECOLHIDA : SIDEBAR_WIDTH,
        transform: isMobile && !isOpen ? 'translateX(-100%)' : 'translateX(0)',
        zIndex: isMobile ? 100 : 50,
      }}
      onClick={(e) => {
        if (isMobile && (e.target as HTMLElement).closest('a')) onClose();
      }}
    >
      {/* Logo oficial (ou logo da empresa quando configurado) + dark mode toggle */}
      <SidebarLogo
        role={role}
        recolhida={recolhida}
        onAlternar={isMobile ? undefined : onAlternarRecolhida}
      />

      {/* Multi-tenant: trocar empresa ativa (ADMIN vê todas; demais só vinculadas).
          Fora do modo recolhido: é um seletor com NOME de empresa — não existe
          versão de 60px dele que não minta sobre qual empresa está ativa. */}
      {!recolhida && <EmpresaSwitcher />}

      {/* Quick search (cmdk) — DESATIVADO por pedido do Léo (2026-08-05): o
          placeholder parecia clicável (cursor-pointer + hover) mas não fazia
          nada — sem onClick nem atalho ⌘K real. Reativar quando a busca
          global existir de verdade. */}

      {/* Nav scrollable — arrastável (reordena pelos "punhos", persiste no dispositivo) */}
      <nav className={cn('flex-1 overflow-y-auto py-2.5', recolhida ? 'px-1.5' : 'px-2')}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visiveis.map((i) => i.to)} strategy={verticalListSortingStrategy}>
            <div className="mb-3">
              {visiveis.map((item) => (
                <SortableNavItem
                  key={item.to}
                  item={item}
                  active={isActive(item)}
                  count={item.badgeKey ? badges[item.badgeKey] : 0}
                  recolhida={recolhida}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </nav>

      {/* User card no rodapé */}
      <Link
        to="/perfil"
        title={recolhida ? 'Ver perfil' : undefined}
        aria-label={recolhida ? 'Ver perfil' : undefined}
        className={cn(
          'flex items-center py-2.5 border-t border-border',
          'hover:bg-surface-hover transition-colors group',
          recolhida ? 'justify-center px-0' : 'gap-2.5 px-3',
        )}
      >
        <Avatar name={role ?? '—'} size="sm" />
        {!recolhida && (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text truncate">
                {role ? ROLE_LABEL[role] ?? role : 'Sem sessão'}
              </div>
              <div className="text-[11px] text-muted truncate">Ver perfil</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </>
        )}
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
        title={recolhida ? 'Sair' : undefined}
        aria-label={recolhida ? 'Sair' : undefined}
        className={cn(
          'flex items-center py-2.5 w-full',
          'text-sm text-muted hover:text-danger hover:bg-surface-hover transition-colors',
          recolhida ? 'justify-center px-0' : 'gap-2.5 px-3 text-left',
        )}
      >
        <LogOut className="h-3.5 w-3.5" />
        {!recolhida && 'Sair'}
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
  headerAside,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * Conteúdo da METADE DIREITA do cabeçalho, embaixo dos botões de ação.
   *
   * O cabeçalho tem título e descrição à esquerda e os botões à direita — e no
   * meio, uma faixa larga vazia que só crescia conforme a tela. É onde os
   * indicadores de vendas do dashboard passaram a morar, em vez de ficarem no
   * fim do canvas. Desktop apenas: no mobile o cabeçalho já empilha e não há
   * "lado" nenhum.
   */
  headerAside?: ReactNode;
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
  const [recolhida, alternarRecolhida] = useSidebarRecolhida(!isMobile);
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
      <Sidebar
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        recolhida={recolhida}
        onAlternarRecolhida={alternarRecolhida}
      />
      {isMobile && sidebarOpen && <MobileBackdrop onClick={() => setSidebarOpen(false)} />}
      {isMobile && <MobileTopBar title={title} onToggleSidebar={() => setSidebarOpen((v) => !v)} />}
      <main
        id="main-content"
        style={{
          marginLeft: isMobile ? 0 : recolhida ? SIDEBAR_WIDTH_RECOLHIDA : SIDEBAR_WIDTH,
        }}
        className={cn(
          isMobile ? 'px-4 pb-10 pt-4' : 'px-8 pt-7 pb-12',
          'min-h-screen',
          // Acompanha a largura da sidebar — sem isto o conteúdo salta e a
          // transição fica pela metade (a coluna anima, o miolo não).
          !isMobile && 'transition-[margin] duration-150',
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
            <div
              className={cn(
                'flex flex-col gap-3 min-w-0',
                // Com a fatia preenchida a coluna direita vira metade do
                // cabeçalho; sem ela, continua encolhida do lado dos botões.
                headerAside ? 'flex-1 basis-[520px] max-w-[58%]' : !actionsBelow && 'shrink-0',
              )}
            >
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {actions}
                <NotificationBell />
              </div>
              {headerAside}
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
