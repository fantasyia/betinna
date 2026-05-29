import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Star } from 'lucide-react';
import { colors } from '@/components/styles';
import { useFavoritos, toggleFavorito } from '@/lib/favoritos';

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
  const favoritos = useFavoritos();

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
        const fav = favoritos.some((f) => f.to === tab.to);
        return (
          <div
            key={tab.to}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
              borderBottom: `2px solid ${active ? colors.primary : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            <Link
              to={tab.to}
              role="tab"
              data-testid={testId}
              aria-selected={active}
              style={{
                padding: '0.625rem 0.5rem 0.625rem 1rem',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                color: active ? colors.primary : colors.muted,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {tab.icon}
              {tab.label}
            </Link>
            <button
              type="button"
              data-testid={`fav-${tab.to.replace(/\//g, '-')}`}
              aria-label={fav ? `Remover ${tab.label} dos favoritos` : `Favoritar ${tab.label}`}
              aria-pressed={fav}
              title={fav ? 'Remover dos favoritos' : 'Favoritar'}
              onClick={() => toggleFavorito(tab.to, tab.label)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem 0.625rem 0.25rem 0.125rem',
                color: fav ? colors.warning : colors.muted,
                opacity: fav ? 1 : 0.45,
              }}
            >
              <Star size={13} fill={fav ? colors.warning : 'none'} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
