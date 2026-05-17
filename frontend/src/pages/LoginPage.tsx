import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { setSession } from '@/lib/auth-store';
import type { AuthenticatedUser } from '@/types/auth';

/**
 * LoginPage — refatorado 2026-05-17 (D47: cookie httpOnly).
 *
 * Fluxo:
 *  1. `POST /api/v1/auth/login` no backend → backend fala com Supabase Auth
 *     REST, set cookie httpOnly com refresh, retorna access+expiresAt+userId
 *  2. `GET /api/v1/auth/me` → carrega AuthenticatedUser completo (role,
 *     empresas, etc — campos que NÃO vêm do JWT)
 *  3. setSession() põe accessToken em memória + agenda refresh transparente
 *  4. F5 → main.tsx chama bootstrapAuthFromBackend() que faz POST /refresh
 *     usando o cookie (frontend nem vê o refresh token)
 *
 * Antes: SDK Supabase guardava refresh em localStorage (vulnerável a XSS).
 * Agora o backend é o único que conhece o refresh.
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

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
      // POST /auth/login no backend — set cookie httpOnly com refresh, retorna access
      const loginRes = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // receber Set-Cookie
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        const body = (await loginRes.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? 'Credenciais inválidas');
      }
      const loginJson = (await loginRes.json()) as {
        data: { accessToken: string; expiresAt: number; userId: string };
      };
      const { accessToken, expiresAt } = loginJson.data;

      // Set session em memória ANTES do /auth/me chamar (precisa do token)
      setSession({
        accessToken,
        user: { id: '', email: '', nome: '', role: 'REP', empresaIds: [], empresaIdAtiva: null },
        expiresAt,
      });

      // Backend retorna AuthenticatedUser completo via /auth/me
      const me = await api.get<AuthenticatedUser>('/auth/me');
      setSession({
        accessToken,
        user: me,
        expiresAt,
      });

      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Erro desconhecido',
      );
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
