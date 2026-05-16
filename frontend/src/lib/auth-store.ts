/**
 * Auth store — Sprint 4 FIX 6.
 *
 * **JWT NUNCA em localStorage.** Vive apenas em memória (módulo singleton).
 * Refresh token é gerenciado pelo Supabase SDK em cookie httpOnly.
 *
 * Em refresh de página, o accessToken se perde — o user é levado pra /login
 * (e o Supabase SDK pode auto-restaurar a sessão via refresh).
 *
 * Pattern: pub/sub minimal sem Redux — basta pro caso de uso.
 */
import type { AuthSession } from '@/types/auth';

let session: AuthSession | null = null;
const listeners = new Set<(s: AuthSession | null) => void>();

export function getSession(): AuthSession | null {
  return session;
}

export function setSession(next: AuthSession | null): void {
  session = next;
  for (const l of listeners) l(next);
  // E2E helper — Sprint 4 FIX 7. Expõe token na window APENAS quando
  // `window.__BETINNA_E2E__ === true` (setado por Playwright via init script).
  // Em produção, sempre undefined.
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
}

export function subscribe(listener: (s: AuthSession | null) => void): () => void {
  listeners.add(listener);
  // Notifica estado atual imediatamente
  listener(session);
  return () => listeners.delete(listener);
}

/** Helper pra checar role atual do user. Retorna null se não autenticado. */
export function currentRole() {
  return session?.user?.role ?? null;
}

/** Helper pra empresa ativa atual. */
export function currentEmpresaId() {
  return session?.user?.empresaIdAtiva ?? null;
}
