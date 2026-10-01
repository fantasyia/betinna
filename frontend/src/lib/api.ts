/**
 * API client — Sprint 4 FIX 6.
 *
 * **Único ponto de entrada para chamadas HTTP.** Nenhum `fetch()` direto em
 * componentes — sempre via `api.get/post/patch/delete`.
 *
 * Características:
 *  - Timeout 10s em TODA chamada (AbortController)
 *  - Authorization header automático via auth-store
 *  - 401 → tenta refresh (delegado ao Supabase SDK) → se falhar, navega /login
 *  - 403 → navega /403
 *  - Respeita CORS (credentials: 'include' pra cookie httpOnly do refresh)
 *  - JSON request/response
 *
 * Em testes E2E (Playwright), VITE_API_URL aponta pra Railway staging URL.
 */
import * as Sentry from '@sentry/react';
import {
  clearSession,
  getSession,
  getStoredEmpresaId,
  refreshAccessToken,
  refreshFoiTransitorio,
} from './auth-store';
import { capturarRascunhos } from './dirty';
import { salvarRascunhosAbertos } from './rascunhos';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const API_PREFIX = '/api/v1';
const TIMEOUT_MS = 10_000;
// Escritas (POST/PUT/PATCH/DELETE) ganham mais folga: saves pesados (ex: fluxo faz
// full-replace de todos os nós/arestas numa transação) podem passar de 10s sob carga.
const WRITE_TIMEOUT_MS = 30_000;

/**
 * Adiciona breadcrumb estruturado pro Sentry antes de cada request.
 * Aparece na timeline do Sentry junto da próxima exceção, dando contexto.
 * No-op quando Sentry desabilitado (DSN ausente).
 */
function addRequestBreadcrumb(method: string, url: string): void {
  try {
    Sentry.addBreadcrumb({
      category: 'http',
      message: `${method} ${url}`,
      level: 'info',
      type: 'http',
      data: { method, url },
    });
  } catch {
    // Sentry pode não estar inicializado em dev — silencioso
  }
}

/**
 * Rota da API sem os ids, pro Sentry agrupar por ENDPOINT.
 *
 * `/api/v1/inbox/cmuna5iot000gmn5ivl3fw072/presenca?x=1` → `/inbox/:id/presenca`.
 * Id = segmento com dígito e ≥ 16 caracteres (cuid, uuid, hash), ou só dígitos.
 * Rota com palavra comum (`/kanban/boards`, `/nao-lidas`) fica como está.
 */
export function rotaDaApi(url: string): string {
  let caminho = url;
  try {
    caminho = new URL(url, 'http://x').pathname;
  } catch {
    caminho = url.split('?')[0];
  }
  if (caminho.startsWith(API_PREFIX)) caminho = caminho.slice(API_PREFIX.length);
  return caminho
    .split('/')
    .map((seg) =>
      /^\d+$/.test(seg) || (seg.length >= 16 && /\d/.test(seg) && /^[\w-]+$/.test(seg)) ? ':id' : seg,
    )
    .join('/');
}

/**
 * Impressão digital do erro de API no Sentry: tipo + método + rota.
 *
 * Sem ela o Sentry agrupava pela MENSAGEM, e ele troca a URL por um marcador
 * antes de agrupar — então TODO timeout de GET virava uma issue só e todo
 * timeout de POST, outra. Em 30/09 a BETINNA-FRONT-9 (o "Sincronizar ERP", já
 * consertado) "voltou" porque um timeout de `/inbox/:id/presenca` caiu dentro
 * dela: conserto parecendo falho, e problema novo escondido sob nome velho.
 */
function impressaoDigital(tipo: string, method: string, url: string): string[] {
  return ['api-client', tipo, method.toUpperCase(), rotaDaApi(url)];
}

/**
 * Última vez que a aba ficou ESCONDIDA (ms). Aba em segundo plano tem timer
 * estrangulado e notebook dormindo congela a requisição: o `abort` de 10s
 * dispara ao acordar, sem a API ter culpa nenhuma.
 */
let ultimaVezOculta = 0;
if (typeof document !== 'undefined') {
  if (document.visibilityState === 'hidden') ultimaVezOculta = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') ultimaVezOculta = Date.now();
  });
}

/**
 * O timeout é do CLIENTE, não da API? Navegador offline, ou aba escondida em
 * algum momento enquanto a requisição esperava. Esse não vai pro Sentry: não há
 * o que consertar do nosso lado, e cada engasgo virava uma rajada de issues
 * (01/10: 3 engasgos de notebook = 14 issues, com a API em 7% de CPU).
 */
export function timeoutEhDoCliente(inicio: number, agora = Date.now()): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  return ultimaVezOculta >= inicio && ultimaVezOculta <= agora;
}

/**
 * Reporta erros HTTP no Sentry. Por padrão:
 *  - 5xx → sempre captura (bug do nosso lado ou integração)
 *  - 4xx → não captura (client error: validação, perm, etc — esperado)
 *  - 401/403/404/422 → silencioso (fluxo normal de auth/perm/validação)
 *  - 408/429 → captura como warning (timeout, rate limit — pode ser nosso problema)
 */
function reportApiError(error: ApiError, url: string, method: string, inicio?: number): void {
  try {
    // 5xx sempre
    if (error.status >= 500) {
      Sentry.captureException(error, {
        tags: { source: 'api-client', method, statusGroup: '5xx', rota: rotaDaApi(url) },
        extra: { url, status: error.status, code: error.code },
        fingerprint: impressaoDigital(`http-${error.status}`, method, url),
      });
      return;
    }
    // 408 timeout, 429 rate limit — captura como warning
    const ehTimeout = error.code === 'TIMEOUT' || error.status === 408;
    if (ehTimeout && inicio !== undefined && timeoutEhDoCliente(inicio)) return;
    if (error.status === 408 || error.status === 429 || error.code === 'TIMEOUT') {
      Sentry.captureMessage(`API ${error.code}: ${method} ${url}`, {
        level: 'warning',
        tags: {
          source: 'api-client',
          method,
          statusGroup: error.status === 429 ? '429' : '408',
          rota: rotaDaApi(url),
        },
        // Timeout: UMA issue pra rajada. Quando trava, trava tudo junto (as ~14
        // chamadas de uma tela), então a rota não diz a causa — ela fica na tag
        // `rota`. 429 continua por rota: aí a rota É o endpoint em rajada.
        fingerprint: ehTimeout
          ? ['api-client', 'TIMEOUT']
          : impressaoDigital(error.code || String(error.status), method, url),
        extra: {
          status: error.status,
          code: error.code,
          message: error.message,
        },
      });
    }
    // 4xx esperados (auth/perm/validação) — não polui o Sentry
  } catch {
    // Sentry pode falhar — não derruba a operação principal
  }
}

/** URL pública completa de um endpoint (pra snippets/exemplos exibidos na UI). */
export function publicApiUrl(path: string): string {
  return `${BASE_URL}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Extrai uma mensagem AMIGÁVEL de erro pra mostrar ao usuário.
 *
 * Pro VALIDATION_ERROR do backend (Zod), o payload contém
 * `details: [{ field, message }]`. Sem este helper, o frontend só vê a
 * mensagem genérica "Dados inválidos" — inútil pra debugar qual campo
 * está errado. Aqui pegamos o primeiro erro e formatamos como
 * `"campo: mensagem"`.
 *
 * Pra outros erros, simplesmente retorna `err.message`.
 */
export function apiErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : 'Erro desconhecido';
  }
  // Validação Zod — extrai o primeiro detalhe com field+message
  if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details) && err.details.length > 0) {
    const first = err.details[0] as { field?: string; message?: string };
    const field = (first?.field ?? '').trim();
    const msg = (first?.message ?? '').trim();
    if (field && msg) return `${field}: ${msg}`;
    if (msg) return msg;
  }
  return err.message;
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Override empresa ativa via header X-Empresa-Id */
  empresaId?: string;
  /** Bypass auth (endpoints públicos como /health) */
  skipAuth?: boolean;
  /** Timeout custom em ms */
  timeoutMs?: number;
}

async function request<T>(
  path: string,
  opts: RequestOpts = {},
  retryWithRefresh = true,
): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `${BASE_URL}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;

  const method = opts.method ?? 'GET';
  // Breadcrumb antes da request (Sentry timeline)
  addRequestBreadcrumb(method, url);

  // FormData vai CRU: quem define o `Content-Type` é o browser, porque ele
  // precisa incluir o `boundary` — fixar 'application/json' aqui fazia o
  // servidor receber um corpo que não sabe ler, e cada tela de upload
  // acabava reimplementando o fetch na mão pra fugir disso.
  const ehFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = ehFormData ? {} : { 'Content-Type': 'application/json' };

  if (!opts.skipAuth) {
    const sess = getSession();
    if (sess?.accessToken) {
      headers['Authorization'] = `Bearer ${sess.accessToken}`;
    }
    // Fonte do X-Empresa-Id: override → sessão → empresa persistida (localStorage).
    // O fallback pro localStorage evita que a empresa "suma" num refresh de
    // sessão (era a causa do PUT/salvar dar 403 "Empresa não definida").
    const empresaId = opts.empresaId ?? sess?.user?.empresaIdAtiva ?? getStoredEmpresaId();
    if (empresaId) {
      headers['X-Empresa-Id'] = empresaId;
    }
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const inicioRequisicao = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: ehFormData
        ? (opts.body as FormData)
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
      // credentials: 'include' permite cookie httpOnly do refresh token
      credentials: 'include',
      // `no-store` previne que browser cacheie respostas e envie
      // conditional requests (If-None-Match), o que causaria 304 com body
      // vazio em endpoints autenticados como /auth/me.
      // Auditoria 2026-05-16 — login travado em produção.
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      const timeoutErr = new ApiError(0, 'TIMEOUT', `Requisição excedeu ${timeoutMs / 1000}s`);
      reportApiError(timeoutErr, url, method, inicioRequisicao);
      throw timeoutErr;
    }
    const networkErr = new ApiError(
      0,
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Falha de rede',
    );
    reportApiError(networkErr, url, method);
    throw networkErr;
  }
  clearTimeout(timer);

  // 401 → tenta refresh via cookie httpOnly (D47); se ok, retry da request
  // original; se não, limpa sessão e propaga erro pra router redirecionar.
  if (response.status === 401 && retryWithRefresh && !opts.skipAuth) {
    // ⚠️ CAPTURA ANTES DO AWAIT. `refreshAccessToken()` chama `setSession(null)`
    // quando o refresh é rejeitado — e isso avisa os assinantes, o router manda
    // pro login e as telas DESMONTAM ainda dentro deste await. O cleanup do
    // `useEffect` de cada tela tira ela do registro de "não salvo", então lá
    // embaixo não sobra nada pra salvar.
    //
    // Medido em produção em 17/09: editor de fluxo comprovadamente sujo, sessão
    // derrubada, e `betinna:rascunho:*` nunca escrito. Capturar aqui em cima é
    // barato (só lê um Map) e é o único instante em que a tela ainda existe.
    const rascunhosAntesDoRefresh = capturarRascunhos();
    const refreshed = await refreshAccessToken();
    if (refreshed && !refreshFoiTransitorio()) {
      // Token NOVO: retry sem refresh-loop (retryWithRefresh=false na recursão)
      return request<T>(path, opts, false);
    }
    if (refreshed) {
      // O refresh voltou a MESMA sessão: o backend deu 5xx/429 (ou a rede
      // caiu) e o auth-store já reagendou. Repetir com o token velho daria 401
      // de novo e deslogava no meio do trabalho (auditoria 13/09, G-3).
      throw new ApiError(401, 'AUTH_REQUIRED', 'Sessão em renovação — tente de novo');
    }
    // Sessão morreu de vez. Antes de desmontar tudo, guarda o que estava
    // digitado (G-9) — o refresh já falhou, então ficar na tela não salvaria
    // nada; o único jeito de não perder é levar o conteúdo pro outro lado do
    // login. Best-effort: nunca impede o logout.
    salvarRascunhosAbertos(rascunhosAntesDoRefresh);
    clearSession();
    throw new ApiError(401, 'AUTH_REQUIRED', 'Não autenticado');
  }
  if (response.status === 401) {
    // Fluxo público (welcome / redefinir senha, `skipAuth`): o 401 aqui não é
    // "sessão caiu", é o backend explicando por que o token do link não serve
    // ("já foi usado", "substituído por um mais novo"). Engolir isso em
    // "Não autenticado" foi o que deixou o Léo sem saber o que fazer em 06/09.
    if (opts.skipAuth) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      clearSession();
      throw new ApiError(
        401,
        body?.error?.code ?? 'AUTH_REQUIRED',
        body?.error?.message ?? 'Não autenticado',
      );
    }
    salvarRascunhosAbertos(); // G-9 — ver acima
    clearSession();
    throw new ApiError(401, 'AUTH_REQUIRED', 'Não autenticado');
  }

  // 403 → frontend redireciona para /403
  if (response.status === 403) {
    // Permissão pode ter sido revogada AGORA pelo admin — pede ao permissions-store
    // pra revalidar a matriz viva (menu/rotas se ajustam sem F5). Evento evita
    // import circular (permissions-store importa api).
    window.dispatchEvent(new Event('betinna:perm-refresh'));
    const body = await safeJson(response);
    const errObj = (body?.error ?? {}) as Record<string, unknown>;
    throw new ApiError(
      403,
      (errObj.code as string) ?? 'FORBIDDEN',
      (errObj.message as string) ?? 'Acesso negado',
      errObj.details,
    );
  }

  // 2xx
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    const body = await safeJson(response);
    // Backend retorna { success: true, data, meta }
    if (body && typeof body === 'object' && 'data' in body) {
      return body.data as T;
    }
    return body as T;
  }

  // 4xx/5xx — extrai mensagem do envelope padrão
  const errBody = await safeJson(response);
  const errObj = (errBody?.error ?? {}) as Record<string, unknown>;
  const apiErr = new ApiError(
    response.status,
    (errObj.code as string) ?? 'UNKNOWN_ERROR',
    (errObj.message as string) ?? `HTTP ${response.status}`,
    errObj.details,
  );
  reportApiError(apiErr, url, method);
  throw apiErr;
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── API pública ────────────────────────────────────────────────────────

/**
 * Baixa um arquivo (ex: CSV) de um endpoint autenticado e dispara o download.
 * Usa o mesmo token/base do `api`. Pra respostas binárias/texto (não-JSON).
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const url = path.startsWith('http')
    ? path
    : `${BASE_URL}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
  // Mesmo contrato do request: Authorization + X-Empresa-Id (sessão → localStorage) + refresh
  // 1× em 401. Sem isso, download autenticado podia dar 403 'Empresa não definida' ou 401 sem retry.
  const fetchOnce = async (): Promise<Response> => {
    const sess = getSession();
    const empresaId = sess?.user?.empresaIdAtiva ?? getStoredEmpresaId();
    const headers: Record<string, string> = {};
    if (sess?.accessToken) headers.Authorization = `Bearer ${sess.accessToken}`;
    if (empresaId) headers['X-Empresa-Id'] = empresaId;
    return fetch(url, { headers });
  };
  let res = await fetchOnce();
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await fetchOnce();
  }
  if (!res.ok) {
    throw new ApiError(res.status, 'DOWNLOAD_ERROR', `Falha no download (${res.status})`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, {
      timeoutMs: WRITE_TIMEOUT_MS,
      ...opts,
      method: 'POST',
      body,
    }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, {
      timeoutMs: WRITE_TIMEOUT_MS,
      ...opts,
      method: 'PATCH',
      body,
    }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, {
      timeoutMs: WRITE_TIMEOUT_MS,
      ...opts,
      method: 'PUT',
      body,
    }),
  delete: <T>(path: string, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, {
      timeoutMs: WRITE_TIMEOUT_MS,
      ...opts,
      method: 'DELETE',
    }),
  /** Upload multipart — arquivo grande merece um timeout maior que o de escrita. */
  upload: <T>(path: string, form: FormData, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, {
      timeoutMs: 120_000,
      ...opts,
      method: 'POST',
      body: form,
    }),
};
