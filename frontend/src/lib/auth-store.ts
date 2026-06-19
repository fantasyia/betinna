/**
 * Auth store — pub/sub minimal com refresh via cookie httpOnly (D47).
 *
 * **Política de armazenamento (atualizada 2026-05-17, upgrade D47):**
 *  - `accessToken` vive em MEMÓRIA (este módulo) — não em localStorage
 *  - `refreshToken` é gerenciado pelo BACKEND em cookie httpOnly (não
 *    acessível via JS, imune a XSS)
 *  - `bootstrapAuthFromBackend()` chamado no boot tenta refresh via cookie
 *  - Refresh transparente agendado por timer baseado em `expiresAt`
 *
 * Antes (sessão anterior): refresh em localStorage via Supabase SDK
 * (vulnerável a XSS). Agora o frontend nem vê o refresh — só fala com
 * `/api/v1/auth/login`, `/auth/refresh`, `/auth/signout` (cookies httpOnly).
 */
import type { AuthSession, AuthenticatedUser } from '@/types/auth';
import { setSentryUser } from './sentry';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

/** Margem antes do exp pra agendar refresh transparente. */
const REFRESH_MARGIN_MS = 60_000;

let session: AuthSession | null = null;
const listeners = new Set<(s: AuthSession | null) => void>();
/** Estado de inicialização — UI pode mostrar spinner em vez de redirect prematuro. */
let initializing = true;
const initListeners = new Set<(loading: boolean) => void>();

/** Timer do refresh transparente. */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function getSession(): AuthSession | null {
  return session;
}

export function isInitializing(): boolean {
  return initializing;
}

export function setSession(next: AuthSession | null): void {
  session = next;
  // Persiste a empresa ativa em localStorage SEMPRE que houver uma — assim o
  // header X-Empresa-Id sobrevive a refreshes de sessão (antes ele "piscava"
  // pra null num refresh e o PUT saía sem empresa → 403 "Empresa não definida").
  if (next?.user?.empresaIdAtiva) setStoredEmpresaId(next.user.empresaIdAtiva);
  // Mantém o Sentry user em sync. id apenas (sem email/PII) — beforeSend
  // do sentry.ts strip qualquer PII residual de qualquer jeito.
  setSentryUser(next?.user?.id ?? null);
  // Agenda refresh transparente quando há sessão.
  scheduleRefresh(next);
  for (const l of listeners) l(next);
  // E2E helper. Expõe token na window APENAS quando `window.__BETINNA_E2E__ === true`
  // (setado por Playwright via init script). Em produção, sempre undefined.
  if (typeof window !== 'undefined') {
    const w = window as unknown as {
      __BETINNA_E2E__?: boolean;
      __authToken__?: string | null;
      __empresaIdAtiva__?: string | null;
    };
    if (w.__BETINNA_E2E__) {
      w.__authToken__ = next?.accessToken ?? null;
      w.__empresaIdAtiva__ = next?.user?.empresaIdAtiva ?? null;
    }
  }
}

export function clearSession(): void {
  cancelRefresh();
  setSession(null);
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(EMPRESA_KEY);
  } catch {
    /* best-effort */
  }
  // Apaga cookie httpOnly no backend + revoga refresh no Supabase
  void fetch(`${API_BASE}/api/v1/auth/signout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {
    /* best-effort */
  });
}

export function subscribe(listener: (s: AuthSession | null) => void): () => void {
  listeners.add(listener);
  listener(session);
  return () => listeners.delete(listener);
}

export function subscribeInitializing(listener: (loading: boolean) => void): () => void {
  initListeners.add(listener);
  listener(initializing);
  return () => initListeners.delete(listener);
}

function setInitializing(v: boolean): void {
  initializing = v;
  for (const l of initListeners) l(v);
}

/** Helper pra checar role atual do user. Retorna null se não autenticado. */
export function currentRole() {
  return session?.user?.role ?? null;
}

/** Helper pra empresa ativa atual. */
export function currentEmpresaId() {
  return session?.user?.empresaIdAtiva ?? null;
}

/**
 * Empresa ativa escolhida no seletor — persistida em localStorage pra
 * SOBREVIVER ao reload da página (o switch recarrega a página, e o bootstrap
 * recriava a sessão sem lembrar a empresa escolhida → header sumia → 403).
 */
// Chave padronizada no separador ':' (era 'betinna.empresaAtiva').
const EMPRESA_KEY = 'betinna:empresaAtiva';
const EMPRESA_KEY_LEGACY = 'betinna.empresaAtiva';
export function getStoredEmpresaId(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    // Fallback na chave antiga (migra a escolha do usuário sem perder).
    return (
      window.localStorage.getItem(EMPRESA_KEY) ??
      window.localStorage.getItem(EMPRESA_KEY_LEGACY)
    );
  } catch {
    return null;
  }
}
function setStoredEmpresaId(id: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (id) window.localStorage.setItem(EMPRESA_KEY, id);
  } catch {
    /* localStorage indisponível — segue sem persistir */
  }
}

/**
 * Troca a empresa ativa (multi-tenant). Atualiza o `empresaIdAtiva` no
 * AuthSession em memória — todas as próximas chamadas de `api.*` vão
 * passar essa empresa no header `X-Empresa-Id`.
 *
 * Importante: depois de chamar isso, **recarregue a página** pra limpar
 * todos os caches em memória (useApiQuery, etc.). Misturar dados de
 * dois tenants na mesma sessão = bug em potencial. Por isso o helper
 * sempre dispara `window.location.reload()` no final.
 */
export function switchEmpresaAtiva(empresaId: string): void {
  if (!session) return;
  if (session.user.empresaIdAtiva === empresaId) return;
  // Valida que a empresa pertence ao user (defesa em profundidade —
  // o backend valida também, mas evita uma viagem inútil)
  if (session.user.role !== 'ADMIN' && !session.user.empresaIds.includes(empresaId)) {
    return;
  }
  setSession({
    ...session,
    user: { ...session.user, empresaIdAtiva: empresaId },
  });
  if (typeof window !== 'undefined') {
    // Persiste a escolha pra sobreviver ao reload (senão o bootstrap reseta).
    try {
      window.localStorage.setItem(EMPRESA_KEY, empresaId);
    } catch {
      /* localStorage indisponível — segue sem persistir */
    }
    // Reload pra limpar caches em memória — evita misturar dados de tenants.
    window.location.reload();
  }
}

// ─── Bootstrap & refresh transparente ───────────────────────────────────

/**
 * Helper: fetch com timeout via AbortController.
 * Hotpatch 2026-05-20: sem timeout, fetch pode ficar pendurado indefinido
 * quando Service Worker velho intercepta ou backend não responde —
 * isso travava o bootstrap (`isInitializing` nunca virava false).
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Busca AuthenticatedUser completo do backend usando o access token atual. */
async function fetchMe(accessToken: string): Promise<AuthenticatedUser | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: AuthenticatedUser };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Faz refresh via backend (`POST /auth/refresh` que lê cookie httpOnly).
 * Retorna a nova sessão ou null se cookie inválido/ausente.
 */
export async function refreshAccessToken(): Promise<AuthSession | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // envia cookie httpOnly
    });
    if (!res.ok) {
      setSession(null);
      return null;
    }
    const json = (await res.json()) as {
      data?: { accessToken: string; expiresAt: number; userId: string };
    };
    const data = json.data;
    if (!data?.accessToken) {
      setSession(null);
      return null;
    }
    // Busca AuthenticatedUser do backend (role, empresas, etc — não vem do JWT)
    const me = await fetchMe(data.accessToken);
    if (!me) {
      setSession(null);
      return null;
    }
    // Reaplica a empresa escolhida no seletor (persistida) — sobrevive ao reload.
    // Só aplica se for válida pro usuário (ADMIN pode qualquer; demais só as suas).
    const stored = getStoredEmpresaId();
    if (stored && (me.role === 'ADMIN' || (me.empresaIds ?? []).includes(stored))) {
      me.empresaIdAtiva = stored;
    }
    const next: AuthSession = {
      accessToken: data.accessToken,
      user: me,
      expiresAt: data.expiresAt,
    };
    setSession(next);
    return next;
  } catch {
    setSession(null);
    return null;
  }
}

/**
 * Chamado uma vez no boot do App (main.tsx).
 *
 * Tenta `POST /auth/refresh` (lê cookie httpOnly). Se cookie válido,
 * popula store; se não, fica sem sessão (UI mostra login).
 */
export async function bootstrapAuthFromBackend(): Promise<AuthSession | null> {
  try {
    return await refreshAccessToken();
  } finally {
    setInitializing(false);
  }
}

/**
 * Agenda refresh transparente ~60s antes do access expirar. Quando dispara,
 * chama o backend (que lê cookie e troca por novo access). Reagenda quando
 * a nova sessão chega.
 *
 * Cancela timer anterior (idempotente) — toda mudança de sessão re-agenda.
 */
function scheduleRefresh(s: AuthSession | null): void {
  cancelRefresh();
  if (!s?.expiresAt) return;
  const msUntil = s.expiresAt - Date.now() - REFRESH_MARGIN_MS;
  if (msUntil <= 0) {
    // Token já expirado ou prestes a — refresh imediato
    void refreshAccessToken();
    return;
  }
  refreshTimer = setTimeout(() => {
    void refreshAccessToken();
  }, msUntil);
}

function cancelRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}
