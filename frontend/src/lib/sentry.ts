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
// PERF: @sentry/react (~469KB, MAIOR que o React) carrega LAZY — só quando há DSN (ENABLED) e só
// dentro do initSentry. Sem DSN era 469KB de peso morto no caminho crítico (sentry.ts é importado
// ESTÁTICO por ErrorBoundary + auth-store). `Sentry` fica null até o import dinâmico resolver.
type SentryModule = typeof import('@sentry/react');
let Sentry: SentryModule | null = null;
/** user setado antes do SDK carregar (login no bootstrap) — aplicado quando o SDK chega. */
let pendingUserId: string | null = null;

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? '';
const ENV = (import.meta.env.MODE as string | undefined) ?? 'development';
const ENABLED = DSN.length > 0;

/** Patterns `chave=valor` que NÃO devem ir pro log (PII / ruído conhecido). */
const REDACT_PATTERNS = [
  /password=[^&\s]+/gi,
  /token=[^&\s]+/gi,
  /bearer\s+[a-z0-9._-]+/gi,
  /apikey=[^&\s]+/gi,
];

/**
 * Patterns POSICIONAIS (o valor sensível está no path, não em `chave=valor`) — o trecho
 * inteiro é trocado. Ex.: o token one-time de aceite de proposta vive no path da URL e
 * vazaria em breadcrumbs/URL do Sentry se não for redigido aqui.
 */
const REDACT_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/\/propostas?\/aceite\/[^/?#\s]+/gi, '/proposta/aceite/[REDACTED]'],
];

/**
 * PII DE PESSOA em texto corrido — e-mail, telefone, documento.
 *
 * Os patterns acima cobrem SEGREDO (`token=`, `bearer`, o path de aceite). Esta
 * lista cobre PESSOA, que é o que este app tem em quase toda tela: o CRM
 * mostra telefone e CPF, e a mensagem de erro que sobe daqui carrega o que
 * estava na mão — inclusive o texto de erro que veio da API.
 *
 * ⚠️ CONSERVADOR, e a razão é esta redação rodar também sobre a PILHA. Limpar
 * demais entrega um evento sem rastro, que é pior que não ter evento: some sem
 * ninguém notar, e só aparece no dia de precisar. Sequência de dígitos solta NÃO
 * é tocada — ela é id, número de pedido ou timestamp muito mais vezes que
 * telefone. Mesma regra do backend (`sanitize-pii.ts`), de propósito: duas
 * definições diferentes pro mesmo risco dariam duas respostas.
 */
const REDACT_PESSOA: Array<[RegExp, (m: string) => string]> = [
  // e-mail em qualquer posição — mantém o domínio, que ajuda a debugar
  [
    /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi,
    (m) => {
      const i = m.indexOf('@');
      const local = m.slice(0, i);
      const visivel = local.length <= 2 ? local[0] : `${local[0]}***${local[local.length - 1]}`;
      return `${visivel}${m.slice(i)}`;
    },
  ],
  // CPF/CNPJ COM pontuação (sem ela seria indistinguível de id)
  [/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, (m) => `***-${m.slice(-2)}`],
  [/(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d)/g, (m) => `***-${m.slice(-2)}`],
  // jid do WhatsApp: o domínio é o que torna os dígitos um telefone
  [
    /(?<!\d)\d{8,15}@(?:s\.whatsapp\.net|c\.us|g\.us)/g,
    (m) => {
      const [d, dom] = m.split('@');
      return `${d.slice(0, 2)}${'*'.repeat(Math.max(0, d.length - 3))}${d.slice(-1)}@${dom}`;
    },
  ],
];

/**
 * Exportado SÓ pra teste: esta função roda sobre a PILHA, e o jeito de errar
 * aqui é silencioso — um evento sem rastro parece um evento normal. Testá-la
 * direto é mais honesto que montar um evento inteiro pra inferir o efeito.
 */
export function redact(s: string): string {
  let out = s;
  for (const p of REDACT_PATTERNS) {
    out = out.replace(p, (m) => m.split('=')[0] + '=[REDACTED]');
  }
  for (const [p, repl] of REDACT_PATH_PATTERNS) {
    out = out.replace(p, repl);
  }
  for (const [p, fn] of REDACT_PESSOA) {
    out = out.replace(p, (m) => fn(m));
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

  // Se ENABLED mas o SDK ainda não carregou (1ºs ms), o erro vai pro log ND-JSON acima; o Sentry
  // só recebe após o import lazy resolver. Trade-off aceitável pra tirar 469KB do caminho crítico.
  if (ENABLED && Sentry) {
    Sentry.captureException(err instanceof Error ? err : new Error(message), {
      extra: extra ? redactObject(extra) : undefined,
    });
  }
}

export function initSentry(): void {
  if (typeof window === 'undefined') return;

  // Diagnóstico no `window` pro Léo validar no console (sem Network tab):
  //   window.__BETINNA_SENTRY__ → { enabled, env, dsnPresent, dsnHost, sdkVersion }
  // `sdkVersion` fica null até o SDK carregar lazy (só acontece quando ENABLED).
  const dsnHost = DSN
    ? (() => {
        try {
          return new URL(DSN).host;
        } catch {
          return 'invalid-url';
        }
      })()
    : null;
  const diag = {
    enabled: ENABLED,
    env: ENV,
    dsnPresent: ENABLED,
    dsnHost,
    sdkVersion: null as string | null,
  };
  (window as unknown as { __BETINNA_SENTRY__?: unknown }).__BETINNA_SENTRY__ = diag;

  // Fallback handlers: capturam mesmo sem DSN (caem pro log ND-JSON via captureError).
  window.addEventListener('error', (e) => {
    captureError(e.error ?? e.message, { source: 'window.error' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    captureError(e.reason, { source: 'unhandledrejection' });
  });

  if (!ENABLED) {
    // DSN ausente → NÃO baixa o bundle do Sentry (469KB). Causa comum: VITE_SENTRY_DSN não estava
    // no build do Railway (Vite congela env em build-time; setar depois exige redeploy).

    console.warn(
      '[Sentry] ⚠️ desabilitado · VITE_SENTRY_DSN não está no bundle. ' +
        'Se a env var existe no Railway, é provável que tenha sido setada APÓS o ' +
        'último build do serviço frontend. Faça um redeploy pra rebuildar com a ' +
        'nova env. Vite injeta env vars em build-time, não runtime.',
    );
    return;
  }

  // ENABLED → carrega o @sentry/react LAZY (fora do caminho crítico) e só então inicializa.
  void import('@sentry/react')
    .then((S) => {
      Sentry = S;
      S.init({
        dsn: DSN,
        environment: ENV,
        // Em prod amostramos 10% das transactions pra controlar custo; dev/staging tudo.
        tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        sendDefaultPii: false,
        beforeSend(event) {
          // Strip user PII (defesa em profundidade)
          if (event.user) {
            delete event.user.email;
            delete event.user.ip_address;
            delete event.user.username;
          }
          if (event.message) event.message = redact(event.message);
          if (event.exception?.values) {
            for (const v of event.exception.values) {
              if (v.value) v.value = redact(v.value);
            }
          }
          if (event.request?.headers) {
            const h = event.request.headers as Record<string, string>;
            if (h.authorization) h.authorization = '[REDACTED]';
            if (h.Authorization) h.Authorization = '[REDACTED]';
            if (h.cookie) h.cookie = '[REDACTED]';
          }
          if (event.breadcrumbs) {
            for (const b of event.breadcrumbs) {
              if (b.message) b.message = redact(b.message);
              if (b.data && typeof b.data === 'object') {
                b.data = redactObject(b.data as Record<string, unknown>);
              }
            }
          }
          // Token de aceite vive no path da URL/transaction → redige (REDACT_PATH_PATTERNS só cobre msg).
          if (event.request?.url) event.request.url = redact(event.request.url);
          if (event.transaction) event.transaction = redact(event.transaction);
          return event;
        },
      });
      diag.sdkVersion = S.SDK_VERSION;
      (window as unknown as { __BETINNA_SENTRY_SDK__?: unknown }).__BETINNA_SENTRY_SDK__ = S;
      // Teste end-to-end: chama captureException direto (bypassa window.onerror).
      //   await window.__BETINNA_TEST_SENTRY__()
      (
        window as unknown as { __BETINNA_TEST_SENTRY__?: () => Promise<string | null> }
      ).__BETINNA_TEST_SENTRY__ = async () => {
        // PII de mentira DE PROPÓSITO: `Error('teste')` chega no Sentry e não
        // prova nada. Erro de verdade neste app carrega e-mail, telefone e CPF,
        // e a pergunta é se ISSO chega limpo — e se o que serve pra debugar
        // (número do pedido, id, pilha) SOBREVIVE.
        // Dados inertes: `.invalid` é TLD reservado (RFC 2606) e não resolve, o
        // telefone é só zeros e o CPF também.
        const eventId = S.captureException(
          new Error(
            `Teste Sentry · ${new Date().toISOString()} · pedido SB2609TESTE / ERP 99 · ` +
              `comprador@exemplo.invalid · 5500000000000@s.whatsapp.net · 000.000.000-00`,
          ),
          { tags: { source: '__BETINNA_TEST_SENTRY__' } },
        );

        console.info(`[Sentry test] eventId=${eventId} — forçando flush (2s)...`);
        try {
          const flushed = await S.flush(2000);

          console.info(
            `[Sentry test] flush ${flushed ? '✅ ok' : '⚠️ timeout/falha'} — confira Network tab + dashboard`,
          );
        } catch (err) {
          console.error('[Sentry test] flush falhou:', err);
        }
        return eventId;
      };
      // Aplica o user que tenha sido setado antes do SDK carregar (login no bootstrap).
      if (pendingUserId) S.setUser({ id: pendingUserId });

      console.info(`[Sentry] ✅ inicializado (lazy) · env=${ENV} · sdk=${S.SDK_VERSION} · host=${dsnHost}`);
    })
    .catch((err) => {
      console.error('[Sentry] falha ao carregar o SDK (lazy):', err);
    });
}

/**
 * Atualiza o user no Sentry quando login acontece. Não enviamos email/ip por
 * privacidade (beforeSend strip), só o `id` (UUID Supabase) que serve pra
 * correlacionar erros sem expor PII.
 */
export function setSentryUser(userId: string | null): void {
  pendingUserId = userId; // lembra mesmo se o SDK ainda não carregou (aplicado no initSentry)
  if (!ENABLED || !Sentry) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
