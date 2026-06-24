import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';
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

  // Comprimento do padrão que casa com o pathname atual (-1 = não casa).
  // Usamos o MAIS específico (mais longo) pra ativar só UMA aba — senão
  // `/mullerbot` ficava ativo junto com `/mullerbot/persona` (bug de aba dupla).
  function matchLen(tab: SubTab): number {
    const path = location.pathname;
    const padroes = [tab.to, ...(tab.match ?? [])];
    let best = -1;
    for (const p of padroes) {
      if (path === p || path.startsWith(p + '/')) best = Math.max(best, p.length);
    }
    return best;
  }

  const activeLen = Math.max(-1, ...tabs.map(matchLen));

  function isActive(tab: SubTab): boolean {
    return activeLen >= 0 && matchLen(tab) === activeLen;
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex border-b border-border mb-4 -mt-2 overflow-x-auto [scrollbar-width:thin]"
    >
      {tabs.map((tab) => {
        const active = isActive(tab);
        const testId = tab.testId ?? `subtab-${tab.to.replace(/\//g, '-')}`;
        const fav = favoritos.some((f) => f.to === tab.to);
        return (
          <div
            key={tab.to}
            className={cn(
              'inline-flex items-center shrink-0 border-b-2 -mb-px',
              active ? 'border-primary' : 'border-transparent',
            )}
          >
            <Link
              to={tab.to}
              role="tab"
              data-testid={testId}
              aria-selected={active}
              className={cn(
                'inline-flex items-center gap-1.5 py-2.5 pr-2 pl-4 text-sm whitespace-nowrap no-underline',
                active ? 'font-semibold text-primary' : 'font-medium text-muted',
              )}
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
              className={cn(
                'inline-flex items-center justify-center cursor-pointer border-none bg-transparent min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 py-1 pr-2.5 pl-0.5',
                fav ? 'text-warning opacity-100' : 'text-muted opacity-45',
              )}
            >
              <Star size={13} fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
