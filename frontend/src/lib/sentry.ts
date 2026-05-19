/**
 * Sentry frontend — opt-in via VITE_SENTRY_DSN no env.
 *
 * Sem DSN configurado: cai pra log estruturado no console (Railway/CloudWatch
 * capturam como ND-JSON). Com DSN: envia pro Sentry real via @sentry/react.
 *
 * O que captura:
 *  - Erros não tratados (window.onerror)
 *  - Promise rejections não tratadas (window.onunhandledrejection)
 *  - Erros de render via <SentryErrorBoundary> no App.tsx
 *  - Erros explicitamente via captureError() (api.ts, error handlers)
 *
 * Privacidade:
 *  - sendDefaultPii: false (Sentry não envia ip/email do user)
 *  - REDACT_PATTERNS striping password/token/bearer/apikey em mensagens
 *  - beforeSend re-aplica redaction em messages, stack, breadcrumbs
 */
import * as Sentry from '@sentry/react';

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? '';
const ENV = (import.meta.env.MODE as string | undefined) ?? 'development';
const ENABLED = DSN.length > 0;

/** Lista de patterns que NÃO devem ir pro log (PII / ruído conhecido). */
const REDACT_PATTERNS = [
  /password=[^&\s]+/gi,
  /token=[^&\s]+/gi,
  /bearer\s+[a-z0-9._-]+/gi,
  /apikey=[^&\s]+/gi,
];

function redact(s: string): string {
  let out = s;
  for (const p of REDACT_PATTERNS) {
    out = out.replace(p, (m) => m.split('=')[0] + '=[REDACTED]');
  }
  return out;
}

interface ErrorContext {
  url: string;
  userAgent: string;
  timestamp: string;
  stack?: string;
}

function buildContext(): ErrorContext {
  return {
    url: typeof window !== 'undefined' ? redact(window.location.href) : 'ssr',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    timestamp: new Date().toISOString(),
  };
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = redact(v);
    else if (v && typeof v === 'object') out[k] = redactObject(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export function captureError(err: unknown, extra?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const payload = {
    level: 'error' as const,
    message: redact(message),
    stack: stack ? redact(stack) : undefined,
    extra: extra ? redactObject(extra) : undefined,
    ...buildContext(),
  };
  // ND-JSON pro Railway/CloudWatch — sempre, mesmo com Sentry ligado.
   
  console.error(JSON.stringify(payload));

  if (ENABLED) {
    Sentry.captureException(err instanceof Error ? err : new Error(message), {
      extra: extra ? redactObject(extra) : undefined,
    });
  }
}

export function initSentry(): void {
  if (typeof window === 'undefined') return;

  // Diagnóstico: expõe o estado da inicialização no `window` pra que Léo
  // consiga validar no console do navegador sem precisar abrir Network tab.
  //
  // Uso no console:
  //   window.__BETINNA_SENTRY__   →  { enabled, env, dsnPresent, dsnHost }
  //
  // Por que precisamos: `@sentry/react` v8+ NÃO expõe `window.Sentry` (é puro
  // ES module). O teste `typeof window.Sentry === 'undefined'` que funcionava
  // nos SDKs antigos via <script> tag não vale mais. Esse `__BETINNA_SENTRY__`
  // dá o sinal explícito.
  const dsnHost = DSN ? (() => {
    try {
      return new URL(DSN).host;
    } catch {
      return 'invalid-url';
    }
  })() : null;
  (window as unknown as { __BETINNA_SENTRY__?: unknown }).__BETINNA_SENTRY__ = {
    enabled: ENABLED,
    env: ENV,
    dsnPresent: ENABLED,
    dsnHost,
    sdkVersion: Sentry.SDK_VERSION,
  };

  if (ENABLED) {
    Sentry.init({
      dsn: DSN,
      environment: ENV,
      // Em prod amostramos 10% das transactions pra controlar custo.
      // Em dev/staging tudo pra debug.
      tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
      // Session replay tem custo extra — manter desligado por enquanto.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Sentry não envia PII automaticamente.
      sendDefaultPii: false,
      beforeSend(event) {
        // Strip user PII (defesa em profundidade)
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
          delete event.user.username;
        }
        // Redact message
        if (event.message) event.message = redact(event.message);
        // Redact stack trace frames
        if (event.exception?.values) {
          for (const v of event.exception.values) {
            if (v.value) v.value = redact(v.value);
          }
        }
        // Strip Authorization header de requests capturados
        if (event.request?.headers) {
          const h = event.request.headers as Record<string, string>;
          if (h.authorization) h.authorization = '[REDACTED]';
          if (h.Authorization) h.Authorization = '[REDACTED]';
          if (h.cookie) h.cookie = '[REDACTED]';
        }
        // Redact breadcrumbs data (podem conter tokens em fetch URLs)
        if (event.breadcrumbs) {
          for (const b of event.breadcrumbs) {
            if (b.message) b.message = redact(b.message);
            if (b.data && typeof b.data === 'object') {
              b.data = redactObject(b.data as Record<string, unknown>);
            }
          }
        }
        return event;
      },
    });

    // eslint-disable-next-line no-console
    console.info(
      `[Sentry] ✅ inicializado · env=${ENV} · sdk=${Sentry.SDK_VERSION} · host=${dsnHost}`,
    );
  } else {
    // DSN ausente — log explícito pra evitar silêncio em produção.
    // Causa MAIS COMUM: `VITE_SENTRY_DSN` não estava setada no Railway
    // quando o serviço frontend foi BUILDADO. Vite congela env vars no
    // bundle em build-time, não em runtime — setar a var depois do build
    // não tem efeito até o próximo redeploy.
    // eslint-disable-next-line no-console
    console.warn(
      '[Sentry] ⚠️ desabilitado · VITE_SENTRY_DSN não está no bundle. ' +
        'Se a env var existe no Railway, é provável que tenha sido setada APÓS o ' +
        'último build do serviço frontend. Faça um redeploy pra rebuildar com a ' +
        'nova env. Vite injeta env vars em build-time, não runtime.',
    );
  }

  // Fallback handlers: capturam mesmo se DSN não configurado (cai pro log)
  window.addEventListener('error', (e) => {
    captureError(e.error ?? e.message, { source: 'window.error' });
  });

  window.addEventListener('unhandledrejection', (e) => {
    captureError(e.reason, { source: 'unhandledrejection' });
  });
}

/**
 * Atualiza o user no Sentry quando login acontece. Não enviamos email/ip por
 * privacidade (beforeSend strip), só o `id` (UUID Supabase) que serve pra
 * correlacionar erros sem expor PII.
 */
export function setSentryUser(userId: string | null): void {
  if (!ENABLED) return;
  if (userId) {
    Sentry.setUser({ id: userId });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * ErrorBoundary do @sentry/react — captura erros de render.
 * Importar do consumer: `import { SentryErrorBoundary } from '@/lib/sentry'`.
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;
