import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { setSession } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import type { AuthenticatedUser } from '@/types/auth';

/**
 * LoginPage — refatorado 2026-05-17.
 *
 * Fluxo:
 *  1. `supabase.auth.signInWithPassword` — SDK persiste sessão em localStorage
 *     com PKCE (sobrevive F5) e habilita refresh transparente
 *  2. Backend `/auth/me` retorna AuthenticatedUser via JWT validado
 *  3. setSession() coloca AuthenticatedUser em memória
 *  4. F5 → main.tsx chama bootstrapAuthFromSupabase() que reusa essa sessão
 *
 * Antes: usávamos `fetch` direto, ignorando o `refresh_token` → F5 deslogava.
 */

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) {
        throw new Error(authError.message);
      }
      const sb = data.session;
      if (!sb?.access_token) {
        throw new Error('Sessão não retornada pelo Supabase — credenciais inválidas?');
      }

      // Set session em memória ANTES do /auth/me chamar (que precisa do token)
      setSession({
        accessToken: sb.access_token,
        user: { id: '', email: '', nome: '', role: 'REP', empresaIds: [], empresaIdAtiva: null },
        expiresAt: (sb.expires_at ?? 0) * 1000,
      });

      // Backend retorna AuthenticatedUser completo via /auth/me
      const me = await api.get<AuthenticatedUser>('/auth/me');
      setSession({
        accessToken: sb.access_token,
        user: me,
        expiresAt: (sb.expires_at ?? 0) * 1000,
      });

      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'white',
          padding: '2rem',
          borderRadius: 8,
          width: 360,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
        data-testid="login-form"
      >
        <h1 style={{ marginTop: 0 }}>Betinna.ai · Entrar</h1>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            data-testid="email"
            style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem' }}>Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            data-testid="password"
            style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
          />
        </div>
        {error && (
          <div
            data-testid="login-error"
            style={{ color: '#dc2626', marginBottom: '1rem', fontSize: '0.875rem' }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          data-testid="login-btn"
          style={{
            width: '100%',
            padding: '0.625rem',
            background: '#7c3aed',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '1rem',
          }}
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
