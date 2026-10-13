import * as Sentry from '@sentry/node';
import type { NodeOptions } from '@sentry/node';
import { sanitize, sanitizarTexto } from '@shared/utils/sanitize-pii';
import { redigirCaminho } from '@shared/utils/redigir-caminho';

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
 *  - `beforeSend` limpa o TEXTO da mensagem/exceção (PII escrito pelo nosso
 *    código), aplica `sanitize()` em data e remove `user.email/ip_address`
 *  - `beforeSendTransaction`/`beforeSendSpan` passam transação e span pelo mesmo
 *    filtro (o `beforeSend` só roda em ERRO) e derrubam o IP do visitante
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
      // A MENSAGEM DO ERRO — por onde o PII escapava.
      //
      // `sendDefaultPii: false` cuida do que o SDK coleta sozinho, e o
      // `sanitize` abaixo cuida dos payloads estruturados. Nenhum dos dois
      // olhava o texto que o NOSSO código escreve, e é nele que está o
      // vazamento: em 09/09 nasceu aqui um erro que carrega o corpo cru do
      // provedor — `Destinatário inválido no WhatsApp: {"jid":"5511…@s.whatsapp
      // .net","number":"5511…"}` — e ele ia inteiro pro Sentry, que é um
      // terceiro.
      //
      // ⚠️ A ESTRUTURA É PRESERVADA: tipo, pilha e frames continuam intactos, e
      // só o TEXTO de dentro é limpo. Filtro que come a própria exceção entrega
      // uma lista de nada — e ninguém descobre até o dia de precisar do rastro.
      if (typeof event.message === 'string') {
        event.message = sanitizarTexto(event.message);
      }
      for (const ex of event.exception?.values ?? []) {
        if (typeof ex.value === 'string') ex.value = sanitizarTexto(ex.value);
      }
      return limparComum(event);
    },
    // Transação e span NÃO passam pelo beforeSend — no SDK ele só roda em
    // evento de ERRO. Sem estes dois, o filtro inteiro ficava fora da
    // telemetria de desempenho (card de 08/10: ~760 spans/semana com o JID
    // cru, vindo do comando do Redis que a auto-instrumentação descreve).
    beforeSendTransaction: (event) => limparTransacao(event),
    beforeSendSpan: (span) => limparSpan(span),
  });

  // eslint-disable-next-line no-console
  console.log(`Sentry inicializado (env=${env})`);
}

type EventoDeErro = Parameters<NonNullable<NodeOptions['beforeSend']>>[0];
type Transacao = Parameters<NonNullable<NodeOptions['beforeSendTransaction']>>[0];
type Span = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0];

/**
 * O que vale pros DOIS tipos de evento que carregam request/usuário: erro e
 * transação. Antes morava dentro do beforeSend, e por isso só o erro passava.
 */
function limparComum<T extends EventoDeErro | Transacao>(event: T): T {
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
  // O CAMINHO da request carrega segredo (Tiny na URL, token legado do
  // Evolution, `t=` do descadastro). `request.url`/`query_string` vêm da
  // requestDataIntegration e não passavam pelo `redigirCaminho` — só o
  // `meta.path` do filtro de exceção passava. Auditoria 29/09/2026.
  if (event.request?.url) {
    event.request.url = redigirCaminho(event.request.url);
  }
  if (typeof event.request?.query_string === 'string') {
    event.request.query_string = event.request.query_string.replace(
      /(^|&)t=[^&]+/g,
      '$1t=[REDACTED]',
    );
  }
  // Corpo da request (webhooks trazem telefone/e-mail do cliente): mesma
  // sanitização por chave que extra/contexts já recebem.
  if (event.request?.data && typeof event.request.data === 'object') {
    event.request.data = sanitize(event.request.data) as Record<string, unknown>;
  }
  // Strip Authorization header de requests capturados
  if (event.request?.headers) {
    const h = event.request.headers as Record<string, string>;
    if (h.authorization) h.authorization = '[REDACTED]';
    if (h.Authorization) h.Authorization = '[REDACTED]';
    if (h.cookie) h.cookie = '[REDACTED]';
  }
  return event;
}

/** IP do visitante: vai cru nesses atributos apesar do `sendDefaultPii: false`. */
const ATRIBUTOS_DE_IP = ['client.address', 'http.client_ip'];

/** Texto livre de telemetria: segredo de caminho primeiro, depois PII. Sem regex nova. */
function limparTextoLivre(texto: string): string {
  return sanitizarTexto(redigirCaminho(texto));
}

/**
 * Atributos de span (url.full, http.target, db.statement…). Todo valor de texto
 * passa pelo mesmo filtro: `redigirCaminho` só casa caminho com segredo e
 * `sanitizarTexto` não toca dígito solto, então id e trace chegam inteiros.
 */
function limparAtributos(dados: Record<string, unknown> | undefined): void {
  if (!dados) return;
  for (const chave of ATRIBUTOS_DE_IP) delete dados[chave];
  for (const [chave, valor] of Object.entries(dados)) {
    if (typeof valor === 'string') dados[chave] = limparTextoLivre(valor);
  }
}

/** beforeSendSpan. Não pode devolver null (o SDK v10 não descarta span por aqui). */
export function limparSpan(span: Span): Span {
  if (typeof span.description === 'string') span.description = limparTextoLivre(span.description);
  limparAtributos(span.data);
  return span;
}

/**
 * beforeSendTransaction: o nome da transação é o caminho concreto, o span raiz
 * mora em `contexts.trace`, e os filhos em `spans` (limpos de novo aqui —
 * idempotente, e não depende da ordem em que o SDK chama os dois ganchos).
 */
export function limparTransacao(event: Transacao): Transacao {
  if (typeof event.transaction === 'string') {
    event.transaction = limparTextoLivre(event.transaction);
  }
  limparAtributos(event.contexts?.trace?.data as Record<string, unknown> | undefined);
  event.spans = event.spans?.map((s) => limparSpan(s));
  return limparComum(event);
}

/**
 * Captura uma exceção no Sentry (manual, fora do auto-capture).
 * Útil para workers BullMQ que não passam pelo middleware HTTP.
 *
 * ⚠️ `fingerprint` existe porque o Sentry agrupa por **pilha** quando há uma, e
 * não pela mensagem. Num ponto de captura genérico — um processor que reporta o
 * erro de QUALQUER job, por exemplo — a pilha é sempre a mesma linha, e erros
 * que não têm nada a ver um com o outro caem na mesma issue. O título que
 * aparece é o do evento mais recente, então o caso grave some atrás do último
 * ruído, e resolver um marca o outro como resolvido junto (medido em 10/09:
 * `BETINNA-API-3` juntou um bug do PAUSAR_IA com uma guarda de envio).
 *
 * Passe `fingerprint` sempre que o ponto de captura for genérico: ele substitui
 * o agrupamento padrão. Os pedaços devem ser ESTÁVEIS (fila, nome do job, uma
 * chave derivada da mensagem) — nunca id, telefone ou timestamp, que criariam
 * uma issue nova por ocorrência.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
  fingerprint?: string[],
): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err, {
    extra: context ? (sanitize(context) as Record<string, unknown>) : undefined,
    fingerprint: fingerprint?.length ? fingerprint : undefined,
  });
}

/**
 * Adiciona breadcrumb (rastro) na timeline do Sentry. Aparece junto da próxima
 * exceção capturada, dando contexto do que aconteceu antes do erro.
 *
 * Usado em paths críticos onde a sequência de eventos importa pro debug:
 * auth flow, push pro ERP, processamento de webhook, fechamento de mês.
 *
 * No-op quando Sentry desligado (SENTRY_DSN vazio).
 *
 * @param category — agrupador (ex: 'auth', 'erp', 'webhook')
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
