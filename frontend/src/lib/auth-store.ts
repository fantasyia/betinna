/**
 * Auth store — pub/sub minimal sincronizado com Supabase SDK.
 *
 * **Política de armazenamento (atualizada 2026-05-17):**
 *  - `accessToken` vive em MEMÓRIA (este módulo) — não em localStorage
 *  - `refreshToken` é gerenciado pelo Supabase SDK (`lib/supabase.ts`),
 *    que persiste em localStorage com PKCE
 *  - SDK faz refresh transparente ~60s antes do access expirar e emite
 *    evento `onAuthStateChange` que atualiza este store
 *  - `bootstrapAuthFromSupabase()` é chamado no boot do App (`main.tsx`)
 *    pra reconstituir sessão após F5
 *
 * Antes da atualização: F5 limpava memória e nada restaurava → /login.
 * Agora: SDK lê refreshToken do localStorage, faz refresh, popula este store.
 */
import type { AuthSession, AuthenticatedUser } from '@/types/auth';
import { supabase } from './supabase';
import { setSentryUser } from './sentry';

let session: AuthSession | null = null;
const listeners = new Set<(s: AuthSession | null) => void>();
/** Estado de inicialização — UI pode mostrar spinner em vez de redirect prematuro. */
let initializing = true;
const initListeners = new Set<(loading: boolean) => void>();

export function getSession(): AuthSession | null {
  return session;
}

export function isInitializing(): boolean {
  return initializing;
}

export function setSession(next: AuthSession | null): void {
  session = next;
  // Mantém o Sentry user em sync. id apenas (sem email/PII) — beforeSend
  // do sentry.ts strip qualquer PII residual de qualquer jeito.
  setSentryUser(next?.user?.id ?? null);
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
  setSession(null);
  // Também invalida no Supabase pra remover refreshToken do localStorage
  void supabase.auth.signOut().catch(() => {
    /* já desconectado */
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

// ─── Bootstrap & sync com Supabase SDK ──────────────────────────────────

/** Busca AuthenticatedUser completo do backend usando o access token atual. */
async function fetchMe(accessToken: string): Promise<AuthenticatedUser | null> {
  try {
    const baseUrl =
      (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
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
 * Chamado uma vez no boot do App (main.tsx ou App raiz).
 *
 * 1. Pergunta ao Supabase SDK se há sessão persistida (refresh já feito)
 * 2. Se há, carrega `/auth/me` do backend e popula o store
 * 3. Subscribe a `onAuthStateChange` pra ficar sincronizado em refresh, signOut,
 *    troca de empresa, etc.
 *
 * Retorna a sessão inicial (ou null). UI pode usar `isInitializing()` durante
 * a primeira chamada pra mostrar spinner em vez de redirecionar pro /login.
 */
export async function bootstrapAuthFromSupabase(): Promise<AuthSession | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const sb = data.session;
    if (!sb?.access_token) {
      setSession(null);
      return null;
    }
    const me = await fetchMe(sb.access_token);
    if (!me) {
      // Token presente mas /auth/me falhou — pode ser que o user foi deletado
      // no DB enquanto a sessão ainda era válida no Supabase. Limpa.
      setSession(null);
      return null;
    }
    const next: AuthSession = {
      accessToken: sb.access_token,
      user: me,
      expiresAt: (sb.expires_at ?? 0) * 1000,
    };
    setSession(next);
    return next;
  } finally {
    setInitializing(false);
  }
}

/**
 * Assina `onAuthStateChange` do SDK para manter o store em sync com:
 *  - TOKEN_REFRESHED (refresh transparente do SDK ~60s antes do exp)
 *  - SIGNED_OUT (logout em outra aba — multi-tab consistency)
 *  - SIGNED_IN (login via SDK — usado pelo LoginPage)
 *
 * Idempotente — chama apenas uma vez no main.tsx.
 */
export function startSupabaseAuthSync(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, sb) => {
    if (event === 'SIGNED_OUT' || !sb) {
      setSession(null);
      return;
    }
    // Para TOKEN_REFRESHED, USER_UPDATED, etc — atualiza só accessToken/expiresAt
    // preservando o `user` do store (vem do backend, não do JWT).
    const current = getSession();
    if (current) {
      setSession({
        ...current,
        accessToken: sb.access_token,
        expiresAt: (sb.expires_at ?? 0) * 1000,
      });
    } else {
      // SIGNED_IN sem store prévio — busca /auth/me
      void fetchMe(sb.access_token).then((me) => {
        if (me) {
          setSession({
            accessToken: sb.access_token,
            user: me,
            expiresAt: (sb.expires_at ?? 0) * 1000,
          });
        }
      });
    }
  });
  return () => data.subscription.unsubscribe();
}
