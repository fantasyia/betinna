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
import { clearSession, getSession, refreshAccessToken } from './auth-store';

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const API_PREFIX = '/api/v1';
const TIMEOUT_MS = 10_000;

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
 * Reporta erros HTTP no Sentry. Por padrão:
 *  - 5xx → sempre captura (bug do nosso lado ou integração)
 *  - 4xx → não captura (client error: validação, perm, etc — esperado)
 *  - 401/403/404/422 → silencioso (fluxo normal de auth/perm/validação)
 *  - 408/429 → captura como warning (timeout, rate limit — pode ser nosso problema)
 */
function reportApiError(error: ApiError, url: string, method: string): void {
  try {
    // 5xx sempre
    if (error.status >= 500) {
      Sentry.captureException(error, {
        tags: { source: 'api-client', method, statusGroup: '5xx' },
        extra: { url, status: error.status, code: error.code },
      });
      return;
    }
    // 408 timeout, 429 rate limit — captura como warning
    if (error.status === 408 || error.status === 429 || error.code === 'TIMEOUT') {
      Sentry.captureMessage(`API ${error.code}: ${method} ${url}`, {
        level: 'warning',
        tags: { source: 'api-client', method, statusGroup: error.status === 429 ? '429' : '408' },
        extra: { status: error.status, code: error.code, message: error.message },
      });
    }
    // 4xx esperados (auth/perm/validação) — não polui o Sentry
  } catch {
    // Sentry pode falhar — não derruba a operação principal
  }
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
  if (
    err.code === 'VALIDATION_ERROR' &&
    Array.isArray(err.details) &&
    err.details.length > 0
  ) {
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

async function request<T>(path: string, opts: RequestOpts = {}, retryWithRefresh = true): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `${BASE_URL}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;

  const method = opts.method ?? 'GET';
  // Breadcrumb antes da request (Sentry timeline)
  addRequestBreadcrumb(method, url);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!opts.skipAuth) {
    const sess = getSession();
    if (sess?.accessToken) {
      headers['Authorization'] = `Bearer ${sess.accessToken}`;
    }
    const empresaId = opts.empresaId ?? sess?.user?.empresaIdAtiva;
    if (empresaId) {
      headers['X-Empresa-Id'] = empresaId;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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
      const timeoutErr = new ApiError(0, 'TIMEOUT', `Requisição excedeu ${TIMEOUT_MS / 1000}s`);
      reportApiError(timeoutErr, url, method);
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
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // Retry sem refresh-loop (retryWithRefresh=false na recursão)
      return request<T>(path, opts, false);
    }
    clearSession();
    throw new ApiError(401, 'AUTH_REQUIRED', 'Não autenticado');
  }
  if (response.status === 401) {
    clearSession();
    throw new ApiError(401, 'AUTH_REQUIRED', 'Não autenticado');
  }

  // 403 → frontend redireciona para /403
  if (response.status === 403) {
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

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
