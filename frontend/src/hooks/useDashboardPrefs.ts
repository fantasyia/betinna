import { useState } from 'react';
import { getSession } from '@/lib/auth-store';

/**
 * F7 (Lote 8) — Dashboard modular: cada usuário escolhe quais seções ver E a
 * largura de cada uma (⅓/½/⅔/cheio). Preferência guardada no localStorage por
 * usuário (sem banco, reversível).
 */
export type DashboardModulo =
  | 'pulso'
  | 'precisa'
  | 'agenda'
  | 'mensagens'
  | 'fluxosSala'
  | 'calendario'
  | 'graficos'
  | 'kpis'
  | 'topReps'
  | 'funil'
  | 'atalhos';

export const DASHBOARD_MODULOS: Array<{ key: DashboardModulo; label: string }> = [
  { key: 'pulso', label: 'Barra de pulso' },
  { key: 'precisa', label: 'Precisa de você' },
  { key: 'agenda', label: 'Agenda de hoje' },
  { key: 'mensagens', label: 'Mensagens internas' },
  { key: 'fluxosSala', label: 'Fluxos — sala de controle' },
  { key: 'calendario', label: 'Calendário de marketing' },
  { key: 'graficos', label: 'Gráficos de relatórios' },
  { key: 'kpis', label: 'Indicadores de vendas' },
  { key: 'topReps', label: 'Top representantes' },
  { key: 'funil', label: 'Funil de leads' },
  { key: 'atalhos', label: 'Atalhos rápidos' },
];

/**
 * Largura em 12 avos (grid de 12 colunas). 4=⅓, 6=½, 8=⅔, 12=cheio.
 * Só vale pros módulos do CANVAS (o trilho Precisa/Agenda/Mensagens é fixo à
 * direita; pulso é sempre full-width).
 */
export type ModuloWidth = 4 | 6 | 8 | 12;

/** Módulos do canvas que o usuário pode redimensionar. */
export const RESIZABLE_MODULOS: DashboardModulo[] = [
  'fluxosSala',
  'calendario',
  'graficos',
  'kpis',
  'topReps',
  'funil',
  'atalhos',
];

export const WIDTH_OPCOES: Array<{ w: ModuloWidth; label: string; titulo: string }> = [
  { w: 4, label: '⅓', titulo: 'Um terço' },
  { w: 6, label: '½', titulo: 'Metade' },
  { w: 8, label: '⅔', titulo: 'Dois terços' },
  { w: 12, label: 'cheio', titulo: 'Largura cheia' },
];

type Prefs = Record<DashboardModulo, boolean>;
type Widths = Partial<Record<DashboardModulo, ModuloWidth>>;

const DEFAULT_VISIBLE: Prefs = {
  pulso: true,
  precisa: true,
  agenda: true,
  mensagens: true,
  fluxosSala: true,
  calendario: true,
  graficos: true,
  kpis: true,
  topReps: true,
  funil: true,
  atalhos: true,
};

// Larguras padrão pensadas pra empacotar bem já de cara (topReps + funil lado a
// lado; o resto cheio, o usuário afina).
const DEFAULT_WIDTHS: Widths = {
  fluxosSala: 12,
  calendario: 12,
  graficos: 12,
  kpis: 12,
  topReps: 6,
  funil: 6,
  atalhos: 12,
};

function storageKey(): string {
  return `betinna:dashboard:${getSession()?.user?.id ?? 'anon'}`;
}

interface Stored {
  visible: Prefs;
  widths: Widths;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return { visible: DEFAULT_VISIBLE, widths: { ...DEFAULT_WIDTHS } };
    const parsed = JSON.parse(raw) as Partial<Stored> & Partial<Prefs>;
    // Formato NOVO ({ visible, widths }) — ou LEGADO (só o mapa de booleans).
    if (parsed && typeof parsed === 'object' && 'visible' in parsed) {
      return {
        visible: { ...DEFAULT_VISIBLE, ...(parsed.visible as Prefs) },
        widths: { ...DEFAULT_WIDTHS, ...(parsed.widths ?? {}) },
      };
    }
    return {
      visible: { ...DEFAULT_VISIBLE, ...(parsed as Partial<Prefs>) },
      widths: { ...DEFAULT_WIDTHS },
    };
  } catch {
    return { visible: DEFAULT_VISIBLE, widths: { ...DEFAULT_WIDTHS } };
  }
}

export function useDashboardPrefs() {
  const [stored, setStored] = useState<Stored>(load);

  function persist(next: Stored) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(next));
    } catch {
      // ignora (modo privado / quota)
    }
  }

  function toggle(k: DashboardModulo) {
    setStored((s) => {
      const next = { ...s, visible: { ...s.visible, [k]: !s.visible[k] } };
      persist(next);
      return next;
    });
  }

  function setWidth(k: DashboardModulo, w: ModuloWidth) {
    setStored((s) => {
      const next = { ...s, widths: { ...s.widths, [k]: w } };
      persist(next);
      return next;
    });
  }

  function widthOf(k: DashboardModulo): ModuloWidth {
    return stored.widths[k] ?? DEFAULT_WIDTHS[k] ?? 12;
  }

  return { prefs: stored.visible, widths: stored.widths, toggle, setWidth, widthOf };
}
