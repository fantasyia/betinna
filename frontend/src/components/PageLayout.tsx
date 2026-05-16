import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useRole, usePermission } from '@/hooks/usePermission';
import { colors, pageWrap } from './styles';

const NAV_ITEMS: Array<{
  to: string;
  label: string;
  permission?: Parameters<typeof usePermission>[0];
}> = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clientes', label: 'Clientes', permission: 'clientes.view' },
  { to: '/produtos', label: 'Produtos' },
  { to: '/catalogo', label: 'Meu catálogo' },
  { to: '/pedidos', label: 'Pedidos' },
  { to: '/aprovacoes', label: 'Aprovações' },
  { to: '/propostas', label: 'Propostas' },
  { to: '/amostras', label: 'Amostras' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/incidentes', label: 'Incidentes' },
  { to: '/ocorrencias', label: 'SAC' },
  { to: '/mullerbot', label: 'MullerBot' },
  { to: '/fluxos', label: 'Fluxos' },
  { to: '/tags', label: 'Tags' },
  { to: '/leads', label: 'Leads' },
  { to: '/agenda', label: 'Agenda' },
  { to: '/comissoes', label: 'Comissões' },
  { to: '/whatsapp', label: 'WhatsApp', permission: 'whatsapp.pessoal' },
  { to: '/integracoes', label: 'Integrações' },
  { to: '/minhas-integracoes', label: 'Minhas integrações' },
  { to: '/perfil', label: 'Meu perfil' },
  { to: '/usuarios', label: 'Usuários' },
  { to: '/configuracoes', label: 'Configurações' },
  { to: '/permissoes', label: 'Permissões' },
  { to: '/admin', label: 'Admin', permission: 'admin.panel' },
];

function NavItem({ to, label }: { to: string; label: string }) {
  const location = useLocation();
  const active =
    location.pathname === to || location.pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      data-testid={`nav-${to.replace('/', '')}`}
      style={{
        padding: '0.5rem 0.875rem',
        borderRadius: 6,
        textDecoration: 'none',
        color: active ? colors.primary : colors.text,
        background: active ? colors.primary + '15' : 'transparent',
        fontWeight: active ? 600 : 500,
        fontSize: 14,
      }}
    >
      {label}
    </Link>
  );
}

function NavBar() {
  const role = useRole();
  const perms = {
    'clientes.view': usePermission('clientes.view'),
    'whatsapp.pessoal': usePermission('whatsapp.pessoal'),
    'admin.panel': usePermission('admin.panel'),
  } as const;
  return (
    <nav
      style={{
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        padding: '0.5rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <strong
          style={{ marginRight: '0.5rem', fontSize: 16, color: colors.primary }}
        >
          Betinna
        </strong>
        {NAV_ITEMS.filter(
          (i) => !i.permission || perms[i.permission as keyof typeof perms],
        ).map((i) => (
          <NavItem key={i.to} to={i.to} label={i.label} />
        ))}
      </div>
      <span style={{ fontSize: 13, color: colors.muted }} data-testid="user-role">
        {role ?? '—'}
      </span>
    </nav>
  );
}

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
      <NavBar />
      <main style={pageWrap}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <h1 data-testid="page-title" style={{ margin: 0, fontSize: 24 }}>
            {title}
          </h1>
          {actions && <div style={{ display: 'flex', gap: '0.5rem' }}>{actions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
