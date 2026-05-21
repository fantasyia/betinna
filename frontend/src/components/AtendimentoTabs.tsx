import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { colors } from '@/components/styles';

/**
 * AtendimentoTabs — sub-abas compartilhadas entre OcorrenciasPage
 * (`/ocorrencias`) e MarketplaceIncidentsPage (`/incidentes`).
 *
 * Decisão R5 (lote 3 — 2026-05-21): em vez de fundir 2 modelos de banco
 * diferentes, agrupamos visualmente as 2 telas como sub-abas de
 * "Atendimento". A sidebar agora tem um único item "Atendimento" que
 * leva pro SAC interno por default — uma vez lá, o usuário troca pra
 * Marketplaces via essas tabs.
 */
export function AtendimentoTabs() {
  const location = useLocation();
  const isSac = location.pathname.startsWith('/ocorrencias');
  const isMarketplace = location.pathname.startsWith('/incidentes');

  return (
    <div
      role="tablist"
      aria-label="Sub-abas de atendimento"
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: `1px solid ${colors.border}`,
        marginBottom: '1rem',
        marginTop: '-0.5rem',
      }}
    >
      <Tab to="/ocorrencias" active={isSac} icon={<AlertTriangle size={14} />} label="SAC interno" />
      <Tab
        to="/incidentes"
        active={isMarketplace}
        icon={<ShieldAlert size={14} />}
        label="Marketplaces"
      />
    </div>
  );
}

function Tab({
  to,
  active,
  icon,
  label,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      role="tab"
      data-testid={`aten-tab-${to.replace('/', '')}`}
      aria-selected={active}
      style={{
        padding: '0.625rem 1rem',
        textDecoration: 'none',
        borderBottom: `2px solid ${active ? colors.primary : 'transparent'}`,
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        color: active ? colors.primary : colors.muted,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: -1,
      }}
    >
      {icon}
      {label}
    </Link>
  );
}
