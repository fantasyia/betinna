import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { colors } from '@/components/styles';

/**
 * SubTabsBar — barra de sub-abas reutilizável.
 *
 * Criada no Lote 9 / N1 (2026-05-21) pra dar suporte à consolidação da
 * navegação. Cada aba principal (Vendas, CRM, Atendimento, Catálogo,
 * Automação, Sistema) tem seu próprio componente wrapper que define os
 * `tabs` e injeta este componente no topo das páginas.
 *
 * A ativação é baseada no `pathname` da rota atual:
 *  - exato OU começa com `tab.to + '/'` → ativo
 *  - tab.match opcional pra rotas que casam com mais de um padrão
 *
 * Cada wrapper específico (VendasTabs, etc.) é quem decide a lista de
 * tabs visíveis pro user — é lá que entram os hooks `usePermission` e
 * `useRole`. Este componente é PURO (não tem hooks de auth).
 */

export interface SubTab {
  /** Rota destino — usada como href E como match de ativo. */
  to: string;
  label: string;
  icon?: ReactNode;
  /** Padrões extras de pathname que devem manter esta tab como ativa. */
  match?: string[];
  /** Identificador estável pra data-testid (default: derivado de `to`). */
  testId?: string;
}

export function SubTabsBar({
  tabs,
  ariaLabel = 'Sub-abas',
}: {
  tabs: SubTab[];
  ariaLabel?: string;
}) {
  const location = useLocation();

  // Se só sobra 1 tab depois do filtro por permissão (ou nenhuma),
  // não renderiza nada — não faz sentido mostrar uma barra com 1 item só.
  if (tabs.length < 2) return null;

  function isActive(tab: SubTab): boolean {
    const path = location.pathname;
    if (path === tab.to) return true;
    if (path.startsWith(tab.to + '/')) return true;
    if (tab.match?.some((m) => path === m || path.startsWith(m + '/'))) return true;
    return false;
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: `1px solid ${colors.border}`,
        marginBottom: '1rem',
        marginTop: '-0.5rem',
        overflowX: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      {tabs.map((tab) => {
        const active = isActive(tab);
        const testId = tab.testId ?? `subtab-${tab.to.replace(/\//g, '-')}`;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            role="tab"
            data-testid={testId}
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
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {tab.icon}
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
