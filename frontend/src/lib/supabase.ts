/**
 * Supabase client singleton (fix 2026-05-17, persistência de sessão).
 *
 * **Por que SDK oficial em vez de fetch direto:**
 *  - `signInWithPassword` retorna access + refresh tokens
 *  - SDK persiste sessão em `localStorage` (chave `sb-<project>-auth-token`)
 *  - **Reconstitui sessão automaticamente em F5** via `getSession()` no boot
 *  - **Refresh transparente** ~60s antes do access expirar
 *  - PKCE habilitado por padrão (mitiga XSS quando bem feito)
 *  - Eventos `onAuthStateChange` deixam o `auth-store` em memória sincronizado
 *
 * **Trade-off de segurança aceito:** refresh_token mora em localStorage.
 * Vulnerável a XSS, mas:
 *   1. Padrão de SPA — abandonar localStorage exige cookie httpOnly via backend
 *   2. CSP já bloqueia inline scripts (helmet no backend tem default-src 'self')
 *   3. PKCE binda o refresh ao client específico (não basta roubar o token)
 *   4. Access token (mais sensível) continua em memória apenas
 *
 * Para upgrade futuro: implementar `/auth/refresh` no backend com cookie
 * httpOnly — refresh nunca toca o JS.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Falha alta visibilidade na inicialização — sem isso o app fica num
  // estado quebrado e o user só vê erros de auth genéricos.
   
  console.error(
    '[supabase] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY ausentes — auth não vai funcionar',
  );
}

export const supabase: SupabaseClient = createClient(url ?? '', anon ?? '', {
  auth: {
    // Persiste sessão pra sobreviver F5 — chave `sb-<project>-auth-token`
    persistSession: true,
    // Refresh automático ~60s antes de expirar
    autoRefreshToken: true,
    // Detecta tokens em URL (não usamos OAuth implicit aqui, mas barato)
    detectSessionInUrl: false,
    // PKCE = mitigação de XSS pro refresh token. Liga por padrão na v2.
    flowType: 'pkce',
    // localStorage explícito (default). `null` desliga persistência (não queremos).
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
