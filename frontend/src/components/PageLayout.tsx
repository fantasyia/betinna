import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useRole, usePermission } from '@/hooks/usePermission';
import { NotificationBell } from '@/components/NotificationBell';
import { colors, radius, shadows, spacing } from './styles';

/** Breakpoint mobile (tablets+ acima disso). */
const MOBILE_BREAKPOINT = 768;

/**
 * Hook pra detectar viewport mobile reativo (window resize).
 * SSR-safe: retorna `false` em ambientes sem `window`.
 *
 * Exportado pra páginas com layout multi-coluna (Inbox, etc) decidirem
 * mostrar lista OU detalhe em vez de side-by-side em telas estreitas.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook coexiste com PageLayout component nesse arquivo; mover quebraria HMR pouco e ganharia pouco
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

/**
 * PageLayout — sidebar vertical + main area.
 *
 * Polish 2026-05-16: substituiu nav horizontal por sidebar fixa com
 * navegação agrupada em seções. Padrão SaaS moderno (Linear/Notion).
 *
 * Sidebar:
 *  - 240px fixa
 *  - Logo + nav agrupada (Visão geral / Vendas / CRM / Atendimento / Admin)
 *  - User role badge no rodapé
 *  - Hover suave + active state com pill
 *
 * Mobile: sidebar vira hamburger (toggle) — implementação simples,
 * pode evoluir.
 */

interface NavItem {
  to: string;
  label: string;
  emoji?: string;
  permission?: Parameters<typeof usePermission>[0];
  allowedRoles?: Array<'ADMIN' | 'DIRECTOR' | 'GERENTE' | 'SAC' | 'REP'>;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Visão geral',
    items: [
      { to: '/dashboard', label: 'Dashboard', emoji: '🏠' },
      { to: '/relatorios', label: 'Relatórios', emoji: '📊', permission: 'relatorios.view' },
    ],
  },
  {
    title: 'Vendas',
    items: [
      { to: '/pedidos', label: 'Pedidos', emoji: '🛒' },
      { to: '/aprovacoes', label: 'Aprovações', emoji: '✓' },
      { to: '/propostas', label: 'Propostas', emoji: '📋' },
      { to: '/amostras', label: 'Amostras', emoji: '🎁' },
      { to: '/comissoes', label: 'Comissões', emoji: '💰' },
    ],
  },
  {
    title: 'CRM',
    items: [
      { to: '/clientes', label: 'Clientes', emoji: '👥', permission: 'clientes.view' },
      { to: '/leads', label: 'Leads', emoji: '🎯' },
      { to: '/agenda', label: 'Agenda', emoji: '📅' },
      { to: '/tags', label: 'Tags', emoji: '🏷️' },
    ],
  },
  {
    title: 'Catálogo',
    items: [
      { to: '/produtos', label: 'Produtos', emoji: '📦' },
      { to: '/catalogo', label: 'Meu catálogo', emoji: '⭐' },
    ],
  },
  {
    title: 'Atendimento',
    items: [
      { to: '/inbox', label: 'Inbox', emoji: '💬' },
      { to: '/ocorrencias', label: 'SAC', emoji: '🚨' },
      { to: '/incidentes', label: 'Incidentes', emoji: '⚠️' },
      { to: '/mullerbot', label: 'MullerBot', emoji: '🤖' },
      { to: '/whatsapp', label: 'WhatsApp', emoji: '📱', permission: 'whatsapp.pessoal' },
    ],
  },
  {
    title: 'Automação',
    items: [
      { to: '/campanhas', label: 'Campanhas', emoji: '📣', permission: 'campanhas.view' },
      { to: '/fluxos', label: 'Fluxos', emoji: '⚡' },
      { to: '/integracoes', label: 'Integrações', emoji: '🔌', allowedRoles: ['ADMIN', 'DIRECTOR', 'GERENTE'] },
      { to: '/minhas-integracoes', label: 'Minhas integrações', emoji: '🔗' },
    ],
  },
  {
    title: 'Administração',
    items: [
      { to: '/perfil', label: 'Meu perfil', emoji: '👤' },
      { to: '/usuarios', label: 'Usuários', emoji: '👨‍💼', allowedRoles: ['ADMIN', 'DIRECTOR', 'GERENTE'] },
      { to: '/fidelidade', label: 'Fidelidade', emoji: '🏆', permission: 'fidelidade.view' },
      { to: '/configuracoes', label: 'Configurações', emoji: '⚙️', allowedRoles: ['ADMIN'] },
      { to: '/permissoes', label: 'Permissões', emoji: '🔐', allowedRoles: ['ADMIN'] },
      { to: '/admin', label: 'Admin Panel', emoji: '🛡️', permission: 'admin.panel' },
    ],
  },
];

const SIDEBAR_WIDTH = 240;

const ROLE_COLOR: Record<string, string> = {
  ADMIN: '#7c3aed',
  DIRECTOR: colors.primary,
  GERENTE: colors.info,
  SAC: colors.warning,
  REP: colors.success,
};

// ─── Sidebar nav item ────────────────────────────────────────────────

function SidebarNavItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      data-testid={`nav-${item.to.replace('/', '')}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        padding: '7px 12px',
        margin: '1px 0',
        borderRadius: radius.md,
        textDecoration: 'none',
        color: active ? colors.primary : colors.textSubtle,
        background: active ? colors.primaryLight : 'transparent',
        fontWeight: active ? 600 : 500,
        fontSize: 13,
        transition: 'background 0.12s ease, color 0.12s ease',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = colors.surfaceHover;
          e.currentTarget.style.color = colors.text;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = colors.textSubtle;
        }
      }}
    >
      {item.emoji && <span style={{ fontSize: 14, opacity: 0.9 }}>{item.emoji}</span>}
      <span>{item.label}</span>
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

  // Pré-resolve permissions pra todos os items
  const perms = {
    'clientes.view': usePermission('clientes.view'),
    'whatsapp.pessoal': usePermission('whatsapp.pessoal'),
    'admin.panel': usePermission('admin.panel'),
    'relatorios.view': usePermission('relatorios.view'),
    'campanhas.view': usePermission('campanhas.view'),
    'fidelidade.view': usePermission('fidelidade.view'),
  } as const;

  function canSee(item: NavItem): boolean {
    if (item.permission && !perms[item.permission as keyof typeof perms]) return false;
    if (item.allowedRoles && (!role || !item.allowedRoles.includes(role))) return false;
    return true;
  }

  function isActive(to: string): boolean {
    return location.pathname === to || location.pathname.startsWith(to + '/');
  }

  // Em mobile, sidebar é drawer overlay. Em desktop, fixa.
  const transform = isMobile && !isOpen ? 'translateX(-100%)' : 'translateX(0)';

  return (
    <aside
      data-testid="sidebar"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: SIDEBAR_WIDTH,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: isMobile ? 100 : 50,
        transform,
        transition: isMobile ? 'transform 0.22s ease' : undefined,
        boxShadow: isMobile && isOpen ? shadows.md : undefined,
      }}
      onClick={(e) => {
        // Fecha drawer ao clicar num link (mobile). Detecta navegação por
        // bubbling do click em anchor.
        if (isMobile && (e.target as HTMLElement).closest('a')) onClose();
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '16px 18px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            background: `linear-gradient(135deg, ${colors.primary} 0%, #8b5cf6 100%)`,
            borderRadius: radius.md,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
            boxShadow: shadows.sm,
          }}
        >
          B
        </div>
        <strong style={{ fontSize: 16, color: colors.text, letterSpacing: -0.2 }}>
          Betinna<span style={{ color: colors.primary }}>.ai</span>
        </strong>
      </div>

      {/* Nav scrollable */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 16px' }}>
        {SECTIONS.map((section) => {
          const visibleItems = section.items.filter(canSee);
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.title} style={{ marginBottom: spacing.md }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                  color: colors.mutedLight,
                  padding: '6px 12px',
                }}
              >
                {section.title}
              </div>
              {visibleItems.map((item) => (
                <SidebarNavItem
                  key={item.to}
                  item={item}
                  active={isActive(item.to)}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {/* User badge */}
      <div
        style={{
          padding: '12px 14px',
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          background: colors.bgAlt,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            background: ROLE_COLOR[role ?? ''] + '1F',
            color: ROLE_COLOR[role ?? ''] ?? colors.muted,
            borderRadius: radius.full,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 11,
          }}
        >
          {role?.slice(0, 2) ?? '—'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontSize: 12, fontWeight: 600, color: colors.text }}
            data-testid="user-role"
          >
            {role ?? 'Sem sessão'}
          </div>
          <Link
            to="/perfil"
            style={{
              fontSize: 11,
              color: colors.muted,
              textDecoration: 'none',
            }}
          >
            ver perfil →
          </Link>
        </div>
      </div>
    </aside>
  );
}

// ─── Mobile top bar (hamburger + title + role badge) ─────────────────

function MobileTopBar({
  title,
  onToggleSidebar,
}: {
  title: string;
  onToggleSidebar: () => void;
}) {
  const role = useRole();
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        padding: '10px 14px',
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        minHeight: 56,
      }}
    >
      <button
        type="button"
        data-testid="mobile-menu-toggle"
        onClick={onToggleSidebar}
        aria-label="Abrir menu"
        style={{
          width: 40,
          height: 40,
          minWidth: 40,
          padding: 0,
          background: 'transparent',
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          fontSize: 20,
          color: colors.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        ☰
      </button>
      <strong
        data-testid="mobile-page-title"
        style={{
          fontSize: 15,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: colors.text,
        }}
      >
        {title}
      </strong>
      {role && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 7px',
            borderRadius: radius.full,
            background: (ROLE_COLOR[role] ?? colors.muted) + '1F',
            color: ROLE_COLOR[role] ?? colors.muted,
          }}
        >
          {role}
        </span>
      )}
      <NotificationBell />
    </header>
  );
}

// ─── Backdrop pra fechar drawer mobile clicando fora ─────────────────

function MobileBackdrop({ onClick }: { onClick: () => void }) {
  return (
    <div
      data-testid="mobile-sidebar-backdrop"
      onClick={onClick}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        zIndex: 90,
        backdropFilter: 'blur(2px)',
      }}
    />
  );
}

// ─── PageLayout principal ────────────────────────────────────────────

export function PageLayout({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Fecha drawer ao trocar de rota (proteção extra além do click handler na Sidebar)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Trava scroll do body quando drawer mobile aberta
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
    <div style={{ background: colors.bg, minHeight: '100vh' }}>
      <Sidebar
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {isMobile && sidebarOpen && <MobileBackdrop onClick={() => setSidebarOpen(false)} />}
      {isMobile && (
        <MobileTopBar title={title} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      )}
      <main
        style={{
          marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
          padding: isMobile ? '16px 14px 32px' : '24px 32px 40px',
          minHeight: isMobile ? 'calc(100vh - 56px)' : '100vh',
        }}
      >
        {/* Header da página: oculto em mobile (já tem MobileTopBar) */}
        {!isMobile && (
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 24,
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <h1
              data-testid="page-title"
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: colors.text,
                letterSpacing: -0.3,
              }}
            >
              {title}
            </h1>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {actions}
              <NotificationBell />
            </div>
          </header>
        )}
        {/* Em mobile, actions ficam num strip embaixo do título mobile */}
        {isMobile && actions && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            {actions}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

