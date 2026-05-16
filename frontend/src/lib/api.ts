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
import { clearSession, getSession } from './auth-store';

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const API_PREFIX = '/api/v1';
const TIMEOUT_MS = 10_000;

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

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `${BASE_URL}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;

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
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      // credentials: 'include' permite cookie httpOnly do refresh token
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', `Requisição excedeu ${TIMEOUT_MS / 1000}s`);
    }
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Falha de rede',
    );
  }
  clearTimeout(timer);

  // 401 → invalida sessão local + manda pra /login (router decide)
  if (response.status === 401) {
    clearSession();
    // Frontend ouve mudança via subscribe — router redireciona
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
  throw new ApiError(
    response.status,
    (errObj.code as string) ?? 'UNKNOWN_ERROR',
    (errObj.message as string) ?? `HTTP ${response.status}`,
    errObj.details,
  );
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
