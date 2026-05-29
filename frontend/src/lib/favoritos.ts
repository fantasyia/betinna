import { useSyncExternalStore } from 'react';
import { getSession } from '@/lib/auth-store';

/**
 * F6 (Lote 8) — Favoritos de navegação por usuário.
 *
 * Guardados no localStorage do navegador, namespaced pelo id do usuário logado
 * (cada pessoa tem os seus). Decisão consciente de NÃO usar o banco por ora:
 * evita migration e é reversível. Se no futuro precisar sincronizar entre
 * dispositivos, troca-se a camada de persistência sem mexer nos componentes.
 *
 * Store mínimo (sem libs) compatível com useSyncExternalStore, pra que a
 * estrela na sub-aba e a barra de acesso rápido reajam na mesma hora.
 */

export interface Favorito {
  /** Rota destino (ex: "/clientes"). Também é a chave única. */
  to: string;
  /** Rótulo exibido no chip de acesso rápido. */
  label: string;
}

const PREFIX = 'betinna:favoritos:';

function storageKey(): string {
  const uid = getSession()?.user?.id ?? 'anon';
  return `${PREFIX}${uid}`;
}

let cache: Favorito[] | null = null;
let cacheKey = '';
const listeners = new Set<() => void>();

function read(): Favorito[] {
  const key = storageKey();
  if (cache && cacheKey === key) return cache;
  try {
    const raw = localStorage.getItem(key);
    cache = raw ? (JSON.parse(raw) as Favorito[]) : [];
  } catch {
    cache = [];
  }
  cacheKey = key;
  return cache;
}

function write(next: Favorito[]): void {
  cacheKey = storageKey();
  cache = next;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(next));
  } catch {
    // localStorage cheio ou indisponível (modo privado) — ignora
  }
  for (const l of listeners) l();
}

export function getFavoritos(): Favorito[] {
  return read();
}

export function isFavorito(to: string): boolean {
  return read().some((f) => f.to === to);
}

/** Liga/desliga um favorito. Mantém a ordem de inserção. */
export function toggleFavorito(to: string, label: string): void {
  const cur = read();
  const exists = cur.some((f) => f.to === to);
  write(exists ? cur.filter((f) => f.to !== to) : [...cur, { to, label }]);
}

export function removeFavorito(to: string): void {
  const cur = read();
  if (cur.some((f) => f.to === to)) write(cur.filter((f) => f.to !== to));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook reativo — re-renderiza quem usa quando os favoritos mudam. */
export function useFavoritos(): Favorito[] {
  return useSyncExternalStore(subscribe, getFavoritos, getFavoritos);
}
