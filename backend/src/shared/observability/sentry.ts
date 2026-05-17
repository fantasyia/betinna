import * as Sentry from '@sentry/node';
import { sanitize } from '@shared/utils/sanitize-pii';

/**
 * Inicialização do Sentry (Sprint 3 FIX 5 + APM 2026-05-17).
 *
 * Chamado em `main.ts` ANTES de qualquer outra coisa (precisa interceptar
 * uncaught exceptions desde o boot — `import { initSentry } from ...; initSentry();`
 * é a primeira linha executável do bootstrap).
 *
 * Características:
 *  - DSN vem de `SENTRY_DSN` (env). Se vazio, Sentry fica desligado (no-op).
 *  - `environment` = NODE_ENV
 *  - **APM**: `tracesSampleRate` configurável via `SENTRY_TRACES_SAMPLE_RATE`
 *    (0–1, default 0.1 em prod, 1.0 em dev). Integrações auto-instrumentam
 *    Express (rotas), HTTP (requests externos), Prisma (queries SQL) e
 *    Redis — sem código manual. Spans aparecem na timeline do Performance.
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
  // tracesSampleRate: 1.0 em dev (sem custo), config explícita em prod (default 0.1).
  // Sentry tracing v10+ auto-instrumenta http/express/prisma/redis se as libs
  // estiverem instaladas — não precisa registrar integration manualmente.
  const tracesSampleRate =
    process.env.SENTRY_TRACES_SAMPLE_RATE !== undefined
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : env === 'production'
        ? 0.1
        : 1.0;

  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate,
    // Auto-instrumentação Node v10+: http, express, prisma, redis, fs, console.
    // Mantemos defaultIntegrations e adicionamos prisma explicitamente.
    integrations: [Sentry.prismaIntegration()],
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
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err, {
    extra: context ? (sanitize(context) as Record<string, unknown>) : undefined,
  });
}

/**
 * Adiciona breadcrumb (rastro) na timeline do Sentry. Aparece junto da próxima
 * exceção capturada, dando contexto do que aconteceu antes do erro.
 *
 * Usado em paths críticos onde a sequência de eventos importa pro debug:
 * auth flow, push pro OMIE, processamento de webhook, fechamento de mês.
 *
 * No-op quando Sentry desligado (SENTRY_DSN vazio).
 *
 * @param category — agrupador (ex: 'auth', 'omie', 'webhook')
 * @param message  — descrição curta do evento
 * @param data     — payload contextual (será sanitizado de PII)
 * @param level    — info (default) | warning | error
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.addBreadcrumb({
    category,
    message,
    level,
    data: data ? (sanitize(data) as Record<string, unknown>) : undefined,
    timestamp: Date.now() / 1000,
  });
}
