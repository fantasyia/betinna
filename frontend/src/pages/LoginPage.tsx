import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { setSession } from '@/lib/auth-store';
import type { AuthenticatedUser } from '@/types/auth';

/**
 * LoginPage — redesign 2026-05-18 (brandbook Betinna oficial).
 *
 * Cores oficiais (BRANDBOOK.md):
 *  - Navy #201554 (primária)
 *  - Cyan #2bcae5 (secundária / focus / destaque)
 *  - Magenta #bd1fbf (acento / CTA dark)
 *  - Bg dark #15093c (navy escuro)
 *
 * Visual:
 *  - Background gradient navy escuro → navy
 *  - Card #201554 com glow magenta sutil
 *  - Logo horizontal no topo
 *  - Inputs com focus ring cyan
 *  - CTA magenta com hover shift
 *  - Mensagens de erro estruturadas com ícone
 *
 * Tipografia: Fira Sans (títulos) + Cabin (corpo)
 * Radius: 10px (padrão Betinna)
 *
 * Fluxo de auth inalterado (D47 — cookie httpOnly do refresh):
 *  1. POST /auth/login → backend seta cookie + retorna access
 *  2. GET /auth/me → carrega AuthenticatedUser completo
 *  3. setSession() em memória + agenda refresh transparente
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

// Tokens oficiais brandbook — usados inline pra independer do html.dark
const COLORS = {
  navy: '#201554',
  navyDeep: '#15093c',
  cyan: '#2bcae5',
  cyanHover: '#1ba8c0',
  magenta: '#bd1fbf',
  magentaHover: '#a01aa1',
  magentaLight: '#d33dd5',
  white: '#F8F7F2',
  danger: '#ee5a5a',
} as const;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  // Fade-in animation no mount
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    // Diagnostic markers — confirmam que o handler está rodando até onde
    // (em caso de loop em "Entrando..." infinito, ver console pra ver
    // qual marker foi atingido). Hotpatch 2026-05-20.
    // eslint-disable-next-line no-console
    console.info('[login] 1. handleSubmit iniciado');

    // Timeout defensivo: se Service Worker velho ou rede pendura o fetch,
    // após 15s o AbortController força reject — finally roda, botão volta.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[login] ⚠️ timeout 15s — abortando fetch');
      controller.abort();
    }, 15_000);

    try {
      // eslint-disable-next-line no-console
      console.info('[login] 2. enviando fetch pra /auth/login', { API_BASE });
      const loginRes = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
        // Hotpatch: cache: 'no-store' evita Service Worker velho interceptar.
        // signal: AbortController dá timeout — sem isso, fetch pendia indef.
        cache: 'no-store',
        signal: controller.signal,
      });
      // eslint-disable-next-line no-console
      console.info('[login] 3. resposta recebida', { status: loginRes.status });

      if (!loginRes.ok) {
        const body = (await loginRes.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        const msg = body?.error?.message;
        if (loginRes.status === 401) {
          throw new Error(msg ?? 'E-mail ou senha incorretos. Tente novamente.');
        }
        if (loginRes.status === 429) {
          throw new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
        }
        if (loginRes.status >= 500) {
          throw new Error('Servidor com problema. Se persistir, fale com o suporte.');
        }
        throw new Error(msg ?? 'Não foi possível entrar. Verifique os dados.');
      }
      const loginJson = (await loginRes.json()) as {
        data: { accessToken: string; expiresAt: number; userId: string };
      };
      const { accessToken, expiresAt } = loginJson.data;

      setSession({
        accessToken,
        user: { id: '', email: '', nome: '', role: 'REP', empresaIds: [], empresaIdAtiva: null },
        expiresAt,
      });
      // eslint-disable-next-line no-console
      console.info('[login] 4. session setada, buscando /auth/me');

      const me = await api.get<AuthenticatedUser>('/auth/me');
      setSession({ accessToken, user: me, expiresAt });
      // eslint-disable-next-line no-console
      console.info('[login] 5. tudo OK, navegando pra', from);

      navigate(from, { replace: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[login] ❌ erro capturado:', err);
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setError(
        isAbort
          ? 'Servidor demorou demais pra responder. Tente novamente em alguns instantes.'
          : err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Erro desconhecido. Tente novamente.',
      );
    } finally {
      clearTimeout(timeoutId);
      // eslint-disable-next-line no-console
      console.info('[login] 6. finally — resetando loading');
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: `radial-gradient(circle at 15% 15%, ${COLORS.navy} 0%, ${COLORS.navyDeep} 55%, ${COLORS.navyDeep} 100%)`,
        fontFamily: '"Cabin", -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Decorações de fundo: blobs sutis magenta + ciano */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20 blur-3xl"
        style={{ background: COLORS.magenta }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-15 blur-3xl"
        style={{ background: COLORS.cyan }}
      />

      <div
        className={`relative w-full max-w-[440px] transition-all duration-500 ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <form
          onSubmit={handleSubmit}
          data-testid="login-form"
          noValidate
          className="rounded-[10px] p-8 sm:p-10 border"
          style={{
            background: 'rgba(32, 21, 84, 0.88)', // #201554 com leve transparência
            borderColor: 'rgba(43, 202, 229, 0.18)', // cyan sutil
            boxShadow:
              '0 0 0 1px rgba(189, 31, 191, 0.12), 0 20px 60px -20px rgba(189, 31, 191, 0.4), 0 8px 32px -8px rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(10px)',
          }}
        >
          {/* Logo horizontal */}
          <div className="flex justify-center mb-7">
            <img
              src="/betinna-horizontal.svg"
              alt="Betinna.ai"
              className="h-10 sm:h-12 w-auto"
              draggable={false}
            />
          </div>

          {/* Título + subtítulo */}
          <div className="text-center mb-8">
            <h1
              className="text-2xl sm:text-3xl tracking-tight m-0"
              style={{
                color: COLORS.white,
                fontFamily: '"Fira Sans", "Cabin", sans-serif',
                fontWeight: 900,
              }}
            >
              Bem-vindo de volta
            </h1>
            <p
              className="mt-2 text-sm"
              style={{ color: COLORS.cyan, fontFamily: '"Cabin", sans-serif' }}
            >
              Entre na sua conta Betinna.ai
            </p>
          </div>

          {/* Email */}
          <div className="mb-5">
            <label
              htmlFor="login-email"
              className="block text-[10px] font-semibold uppercase tracking-[0.1em] mb-2"
              style={{ color: 'rgba(248, 247, 242, 0.65)' }}
            >
              E-mail
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
              data-testid="email"
              placeholder="você@empresa.com.br"
              aria-label="Seu e-mail"
              aria-describedby={error ? 'login-error' : undefined}
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

          {/* Senha */}
          <div className="mb-2">
            <label
              htmlFor="login-password"
              className="block text-[10px] font-semibold uppercase tracking-[0.1em] mb-2"
              style={{ color: 'rgba(248, 247, 242, 0.65)' }}
            >
              Senha
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              data-testid="password"
              placeholder="••••••••"
              aria-label="Sua senha"
              aria-describedby={error ? 'login-error' : undefined}
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

          {/* Link esqueci senha — placeholder visual */}
          <div className="flex justify-end mb-5">
            <a
              href="mailto:suporte@betinna.ai?subject=Recuperar%20senha"
              className="text-xs hover:underline transition-colors"
              style={{ color: COLORS.cyan }}
              onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.magenta)}
              onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.cyan)}
            >
              Esqueceu sua senha?
            </a>
          </div>

          {/* Erro */}
          {error && (
            <div
              id="login-error"
              role="alert"
              data-testid="login-error"
              className="mb-5 flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-sm"
              style={{
                background: 'rgba(238, 90, 90, 0.12)',
                border: '1px solid rgba(238, 90, 90, 0.35)',
                color: '#ffb3b3',
              }}
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span style={{ fontFamily: '"Cabin", sans-serif', lineHeight: 1.4 }}>{error}</span>
            </div>
          )}

          {/* Botão Entrar */}
          <button
            type="submit"
            disabled={loading}
            data-testid="login-btn"
            className="login-submit w-full inline-flex items-center justify-center gap-2"
            style={{
              background: loading ? COLORS.magentaHover : COLORS.magenta,
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 10,
              padding: '0.875rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 700,
              fontFamily: '"Fira Sans", "Cabin", sans-serif',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'transform 150ms, background-color 150ms, box-shadow 150ms',
              boxShadow: loading ? 'none' : '0 6px 20px -6px rgba(189, 31, 191, 0.6)',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = COLORS.magentaLight;
                e.currentTarget.style.transform = 'translateY(-1px) scale(1.005)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.background = COLORS.magenta;
                e.currentTarget.style.transform = 'translateY(0) scale(1)';
              }
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow =
                '0 0 0 3px rgba(43, 202, 229, 0.45), 0 6px 20px -6px rgba(189, 31, 191, 0.6)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = loading
                ? 'none'
                : '0 6px 20px -6px rgba(189, 31, 191, 0.6)';
            }}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: COLORS.cyan }} />
                Entrando…
              </>
            ) : (
              'Entrar'
            )}
          </button>

          {/* Rodapé sutil */}
          <p
            className="text-center text-xs mt-6"
            style={{ color: 'rgba(248, 247, 242, 0.45)', fontFamily: '"Cabin", sans-serif' }}
          >
            Plataforma comercial B2B · Betinna.ai
          </p>
        </form>
      </div>

      {/* CSS scoped pros estados de focus dos inputs */}
      <style>
        {`
          .login-input::placeholder {
            color: rgba(248, 247, 242, 0.35);
          }
          .login-input:focus {
            border-color: ${COLORS.cyan} !important;
            box-shadow: 0 0 0 3px rgba(43, 202, 229, 0.22) !important;
          }
          .login-input:hover:not(:focus) {
            border-color: rgba(43, 202, 229, 0.35);
          }
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}
