/**
 * Sentry frontend — opt-in via VITE_SENTRY_DSN no env.
 *
 * Não instalamos `@sentry/react` como dependência hard porque:
 *  - MVP não tem operação de produção real ainda
 *  - Dep adiciona ~30KB ao bundle
 *  - Quando ativar, adicionar `@sentry/react` ao package.json + descomentar
 *
 * Por enquanto, captura erros via window.onerror + window.onunhandledrejection
 * e loga estruturado no console (Railway captura como ND-JSON).
 */

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? '';
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
  // ND-JSON pro Railway/Cloudwatch
   
  console.error(JSON.stringify(payload));

  // Quando Sentry estiver habilitado, enviar via beacon:
  if (ENABLED) {
    // TODO: integrar @sentry/react ou enviar via fetch beacon pro DSN
    // Por ora, só o log estruturado.
  }
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

export function initSentry(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    captureError(e.error ?? e.message, { source: 'window.error' });
  });

  window.addEventListener('unhandledrejection', (e) => {
    captureError(e.reason, { source: 'unhandledrejection' });
  });

  if (ENABLED) {
     
    console.info('[Sentry] habilitado (DSN configurado)');
  }
}
