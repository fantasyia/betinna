import { useState } from 'react';
import { getSession } from '@/lib/auth-store';

/**
 * F7 (Lote 8) — Dashboard modular: cada usuário escolhe quais seções ver.
 * Preferência guardada no localStorage por usuário (sem banco, reversível).
 */
export type DashboardModulo =
  | 'pulso'
  | 'precisa'
  | 'fluxosSala'
  | 'kpis'
  | 'topReps'
  | 'funil'
  | 'atalhos';

export const DASHBOARD_MODULOS: Array<{ key: DashboardModulo; label: string }> = [
  { key: 'pulso', label: 'Barra de pulso' },
  { key: 'precisa', label: 'Precisa de você' },
  { key: 'fluxosSala', label: 'Fluxos — sala de controle' },
  { key: 'kpis', label: 'Indicadores de vendas' },
  { key: 'topReps', label: 'Top representantes' },
  { key: 'funil', label: 'Funil de leads' },
  { key: 'atalhos', label: 'Atalhos rápidos' },
];

type Prefs = Record<DashboardModulo, boolean>;
const DEFAULT: Prefs = {
  pulso: true,
  precisa: true,
  fluxosSala: true,
  kpis: true,
  topReps: true,
  funil: true,
  atalhos: true,
};

function storageKey(): string {
  return `betinna:dashboard:${getSession()?.user?.id ?? 'anon'}`;
}

export function useDashboardPrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      const raw = localStorage.getItem(storageKey());
      return raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });

  function toggle(k: DashboardModulo) {
    setPrefs((p) => {
      const next = { ...p, [k]: !p[k] };
      try {
        localStorage.setItem(storageKey(), JSON.stringify(next));
      } catch {
        // ignora (modo privado / quota)
      }
      return next;
    });
  }

  return { prefs, toggle };
}
