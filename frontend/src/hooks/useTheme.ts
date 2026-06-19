import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

// Chaves de localStorage padronizadas no separador ':' (era 'betinna-theme').
const STORAGE_KEY = 'betinna:theme';
const STORAGE_KEY_LEGACY = 'betinna-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = (localStorage.getItem(STORAGE_KEY) ??
    localStorage.getItem(STORAGE_KEY_LEGACY)) as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  // Respeita preferência do sistema
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/**
 * Hook + utility pra controlar light/dark mode da aplicação.
 *
 * - Persiste no localStorage
 * - Aplica `class="dark"` no <html>
 * - Respeita prefers-color-scheme do sistema na primeira visita
 */
export function useTheme(): [Theme, (t: Theme) => void, () => void] {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }
  function toggleTheme() {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return [theme, setTheme, toggleTheme];
}

/** Boot — aplica tema antes do React hidratar (evita flash). */
export function bootstrapTheme() {
  applyTheme(getInitialTheme());
}
