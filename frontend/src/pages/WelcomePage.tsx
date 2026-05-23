import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { setSession } from '@/lib/auth-store';
import type { AuthenticatedUser } from '@/types/auth';

/**
 * WelcomePage — finalização do convite (U2 / lote 4, 2026-05-22).
 *
 * O link enviado pelo Supabase Auth termina assim:
 *   https://<frontend>/welcome#access_token=...&refresh_token=...&type=invite&...
 *
 * Esta página:
 *  1. Lê os tokens do hash da URL (location.hash)
 *  2. Valida que existem `access_token` e `type=invite`
 *  3. Mostra formulário "Defina sua senha"
 *  4. POST /auth/welcome { accessToken, password } → backend valida o
 *     token no Supabase, seta a senha, marca user como ATIVO e abre
 *     sessão httpOnly (mesmo retorno do /auth/login)
 *  5. Carrega /auth/me pra popular AuthSession + redireciona pra /dashboard
 *
 * Visual: copiado da LoginPage pra consistência.
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

const COLORS = {
  navy: '#201554',
  navyDeep: '#15093c',
  cyan: '#2bcae5',
  cyanHover: '#1ba8c0',
  magenta: '#bd1fbf',
  magentaHover: '#a01aa1',
  white: '#F8F7F2',
  danger: '#ee5a5a',
  success: '#4cc984',
} as const;

interface HashParams {
  accessToken: string | null;
  type: string | null;
  errorDescription: string | null;
}

function parseHashParams(): HashParams {
  if (typeof window === 'undefined') {
    return { accessToken: null, type: null, errorDescription: null };
  }
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(raw);
  return {
    accessToken: params.get('access_token'),
    type: params.get('type'),
    errorDescription: params.get('error_description') ?? params.get('error'),
  };
}

export default function WelcomePage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const hashParams = useMemo(() => parseHashParams(), []);
  // Aceitamos qualquer "fluxo de senha-nova" do Supabase: invite original,
  // magic link e password recovery. Todos vêm com access_token no hash e
  // o backend consegue setar a senha igual via admin.updateUserById.
  // (Fix U2 2026-05-23 — antes só aceitava `type=invite`.)
  const ACCEPTED_TYPES = ['invite', 'magiclink', 'recovery', 'signup'] as const;
  const linkValido =
    !!hashParams.accessToken &&
    (!hashParams.type ||
      (ACCEPTED_TYPES as readonly string[]).includes(hashParams.type));

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Se o hash trouxer um erro do Supabase, mostra direto
  useEffect(() => {
    if (hashParams.errorDescription) {
      setError(decodeURIComponent(hashParams.errorDescription.replace(/\+/g, ' ')));
    }
  }, [hashParams.errorDescription]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    if (!hashParams.accessToken) {
      setError('Token de convite ausente — peça pra reenviar o convite.');
      return;
    }
    if (password.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // POST /auth/welcome — backend valida token, seta senha, abre sessão
      const r = await api.post<{ accessToken: string; expiresAt: number; userId: string }>(
        '/auth/welcome',
        { accessToken: hashParams.accessToken, password },
        { skipAuth: true },
      );
      // Carrega o user completo (igual login faz)
      const meRes = await fetch(`${API_BASE}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${r.accessToken}` },
        credentials: 'include',
      });
      if (!meRes.ok) throw new ApiError(meRes.status, 'ME_FAILED', 'Falha ao carregar perfil');
      const meJson = (await meRes.json()) as { data?: AuthenticatedUser };
      if (!meJson.data) throw new ApiError(500, 'ME_EMPTY', 'Resposta de /me incompleta');
      setSession({
        accessToken: r.accessToken,
        user: meJson.data,
        expiresAt: r.expiresAt,
      });
      // Limpa o hash pra não vazar o token no histórico
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/welcome');
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao definir senha. Tente novamente.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${COLORS.navyDeep} 0%, ${COLORS.navy} 100%)`,
        fontFamily: '"Cabin", -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Brilho decorativo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20 blur-3xl"
        style={{ background: COLORS.cyan }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-15 blur-3xl"
        style={{ background: COLORS.magenta }}
      />

      <div
        className={`w-full max-w-md relative z-10 transition-all duration-500 ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <div
          className="rounded-[10px] p-8 sm:p-10 border"
          style={{
            background: 'rgba(32, 21, 84, 0.88)',
            borderColor: 'rgba(43, 202, 229, 0.18)',
            boxShadow:
              '0 0 0 1px rgba(189, 31, 191, 0.12), 0 20px 60px -20px rgba(189, 31, 191, 0.4), 0 8px 32px -8px rgba(0, 0, 0, 0.55)',
          }}
        >
          {/* Logo */}
          <div className="flex justify-center mb-7">
            <img
              src="/betinna-horizontal.svg"
              alt="Betinna.ai"
              className="h-10 sm:h-12 w-auto"
              draggable={false}
            />
          </div>

          {/* Título */}
          <div className="text-center mb-8">
            <h1
              className="text-2xl sm:text-3xl tracking-tight m-0"
              style={{
                color: COLORS.white,
                fontFamily: '"Fira Sans", "Cabin", sans-serif',
                fontWeight: 900,
              }}
            >
              Bem-vindo(a)!
            </h1>
            <p
              className="mt-2 text-sm"
              style={{ color: COLORS.cyan, fontFamily: '"Cabin", sans-serif' }}
            >
              Defina uma senha para acessar a sua conta Betinna.ai
            </p>
          </div>

          {/* Link inválido */}
          {!linkValido && !hashParams.errorDescription && (
            <div
              data-testid="welcome-link-invalid"
              role="alert"
              className="mb-5 flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-sm"
              style={{
                background: `${COLORS.danger}22`,
                border: `1px solid ${COLORS.danger}55`,
                color: COLORS.danger,
              }}
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Link de convite inválido ou já usado. Peça pra um administrador reenviar.
              </span>
            </div>
          )}

          {/* Form de senha (apenas com link válido) */}
          {linkValido && (
            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-5">
                <label
                  htmlFor="welcome-password"
                  className="block text-[10px] font-semibold uppercase tracking-[0.1em] mb-2"
                  style={{ color: 'rgba(248, 247, 242, 0.65)' }}
                >
                  Nova senha
                </label>
                <input
                  id="welcome-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  autoFocus
                  minLength={8}
                  data-testid="welcome-password"
                  placeholder="Mínimo 8 caracteres"
                  className="login-input w-full text-base"
                  style={{
                    background: COLORS.navyDeep,
                    color: COLORS.white,
                    border: '2px solid rgba(43, 202, 229, 0.18)',
                    borderRadius: 10,
                    padding: '0.75rem 1rem',
                    fontFamily: '"Cabin", sans-serif',
                    outline: 'none',
                    transition: 'border-color 150ms, box-shadow 150ms',
                  }}
                />
              </div>

              <div className="mb-5">
                <label
                  htmlFor="welcome-confirm"
                  className="block text-[10px] font-semibold uppercase tracking-[0.1em] mb-2"
                  style={{ color: 'rgba(248, 247, 242, 0.65)' }}
                >
                  Confirmar senha
                </label>
                <input
                  id="welcome-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                  data-testid="welcome-confirm"
                  placeholder="Repita a senha"
                  className="login-input w-full text-base"
                  style={{
                    background: COLORS.navyDeep,
                    color: COLORS.white,
                    border: '2px solid rgba(43, 202, 229, 0.18)',
                    borderRadius: 10,
                    padding: '0.75rem 1rem',
                    fontFamily: '"Cabin", sans-serif',
                    outline: 'none',
                    transition: 'border-color 150ms, box-shadow 150ms',
                  }}
                />
              </div>

              {/* Erro */}
              {error && (
                <div
                  data-testid="welcome-error"
                  role="alert"
                  className="mb-5 flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-sm"
                  style={{
                    background: `${COLORS.danger}22`,
                    border: `1px solid ${COLORS.danger}55`,
                    color: COLORS.danger,
                  }}
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !password || !confirm}
                data-testid="welcome-submit"
                className="w-full flex items-center justify-center gap-2 rounded-[10px] font-bold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: COLORS.magenta,
                  color: COLORS.white,
                  border: 'none',
                  padding: '0.9rem 1rem',
                  cursor: loading ? 'wait' : 'pointer',
                  boxShadow: `0 4px 14px ${COLORS.magenta}55`,
                  fontFamily: '"Fira Sans", "Cabin", sans-serif',
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.currentTarget.style.background = COLORS.magentaHover;
                }}
                onMouseLeave={(e) => {
                  if (!loading) e.currentTarget.style.background = COLORS.magenta;
                }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Definindo senha…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Definir senha e entrar
                  </>
                )}
              </button>
            </form>
          )}

          {/* Erro vindo do hash (Supabase rejeitou o link) */}
          {!linkValido && hashParams.errorDescription && (
            <div
              data-testid="welcome-supabase-error"
              role="alert"
              className="mb-5 flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-sm"
              style={{
                background: `${COLORS.danger}22`,
                border: `1px solid ${COLORS.danger}55`,
                color: COLORS.danger,
              }}
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <p
          className="mt-6 text-center text-xs"
          style={{ color: 'rgba(248, 247, 242, 0.4)' }}
        >
          Já tem conta?{' '}
          <a
            href="/login"
            className="hover:underline transition-colors"
            style={{ color: COLORS.cyan }}
          >
            Entrar aqui
          </a>
        </p>
      </div>
    </div>
  );
}
