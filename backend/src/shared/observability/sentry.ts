import * as Sentry from '@sentry/node';
import { sanitize } from '@shared/utils/sanitize-pii';

/**
 * Inicialização do Sentry (Sprint 3 FIX 5).
 *
 * Chamado em `main.ts` ANTES de qualquer outra coisa (precisa interceptar
 * uncaught exceptions desde o boot).
 *
 * Características:
 *  - DSN vem de `SENTRY_DSN` (env). Se vazio, Sentry fica desligado (no-op).
 *  - `environment` = NODE_ENV
 *  - `tracesSampleRate` 0.1 em prod, 1.0 em dev (custo vs visibility)
 *  - `beforeSend` aplica `sanitize()` em data + remove `user.email/ip_address`
 *  - Captura uncaught exceptions e unhandled rejections automaticamente
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.log('Sentry: SENTRY_DSN vazio — observabilidade externa desligada');
    return;
  }

  const env = process.env.NODE_ENV ?? 'development';
  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate: env === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false, // Sentry não envia PII automaticamente
    beforeSend(event) {
      // Strip PII do usuário (mesmo que sendDefaultPii=false, defesa em profundidade)
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      // Sanitiza extra/contexts (que podem conter payloads de jobs/requests)
      if (event.extra) {
        event.extra = sanitize(event.extra) as Record<string, unknown>;
      }
      if (event.contexts) {
        event.contexts = sanitize(event.contexts) as Record<string, Record<string, unknown>>;
      }
      // Strip tokens de breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: b.data ? (sanitize(b.data) as Record<string, unknown>) : undefined,
        }));
      }
      // Strip Authorization header de requests capturados
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        if (h.authorization) h.authorization = '[REDACTED]';
        if (h.Authorization) h.Authorization = '[REDACTED]';
        if (h.cookie) h.cookie = '[REDACTED]';
      }
      return event;
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Sentry inicializado (env=${env})`);
}

/**
 * Captura uma exceção no Sentry (manual, fora do auto-capture).
 * Útil para workers BullMQ que não passam pelo middleware HTTP.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err, {
    extra: context ? (sanitize(context) as Record<string, unknown>) : undefined,
  });
}
