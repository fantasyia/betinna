import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useRole, usePermission } from '@/hooks/usePermission';
import { colors, radius, shadows, spacing } from './styles';

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

function Sidebar() {
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

  return (
    <aside
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
        zIndex: 50,
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

// ─── Mobile menu button (toggle visual — sem implementar overlay agora) ──

function MobileMenuBar() {
  // Placeholder pra futura responsividade. Por ora só mostra info do role
  const role = useRole();
  return (
    <div
      style={{
        display: 'none', // habilitado via media query no CSS global se precisar
        padding: '10px 14px',
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <strong style={{ color: colors.primary }}>Betinna.ai</strong>
      <span style={{ marginLeft: 'auto', fontSize: 12, color: colors.muted }}>
        {role ?? '—'}
      </span>
    </div>
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
  return (
    <div style={{ background: colors.bg, minHeight: '100vh' }}>
      <Sidebar />
      <MobileMenuBar />
      <main
        style={{
          marginLeft: SIDEBAR_WIDTH,
          padding: '24px 32px 40px',
          minHeight: '100vh',
        }}
      >
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
          {actions && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {actions}
            </div>
          )}
        </header>
        {children}
      </main>
    </div>
  );
}

