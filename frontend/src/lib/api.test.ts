import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthSession } from '@/types/auth';

/**
 * Testes do API client (`lib/api.ts`) — o ÚNICO ponto de saída HTTP do app.
 * Se isto quebrar, toda chamada de dados quebra junto (custo de confiança alto).
 *
 * Foco no que importa:
 *  - parsing do envelope ({success,data} → data; erro → ApiError com code/message)
 *  - métodos get/post/put/patch/delete
 *  - headers automáticos (Authorization Bearer + X-Empresa-Id)
 *  - timeout (AbortController → ApiError TIMEOUT, status 0)
 *  - refresh-on-401 (1ª req 401 → refresh → retry uma vez)
 *
 * Mockamos `fetch` (global), o `auth-store` (sessão/refresh/empresa) e o
 * `@sentry/react` (breadcrumbs/captura — não queremos efeito colateral no teste).
 */

// ─── Mocks ──────────────────────────────────────────────────────────────

// Sentry: no-op. api.ts importa addBreadcrumb/captureException/captureMessage.
vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// auth-store: controlamos sessão, empresa persistida, refresh e clearSession.
const getSessionMock = vi.fn<[], AuthSession | null>();
const getStoredEmpresaIdMock = vi.fn<[], string | null>();
const refreshAccessTokenMock = vi.fn<[], Promise<AuthSession | null>>();
const clearSessionMock = vi.fn<[], void>();

vi.mock('./auth-store', () => ({
  getSession: () => getSessionMock(),
  getStoredEmpresaId: () => getStoredEmpresaIdMock(),
  refreshAccessToken: () => refreshAccessTokenMock(),
  clearSession: () => clearSessionMock(),
}));

import { api, ApiError, apiErrorMessage } from './api';

// ─── Helpers ──────────────────────────────────────────────────────────────

// Deriva da mesma fonte que o api.ts (em testes, .env.test seta VITE_API_URL).
const API_ORIGIN =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const BASE = `${API_ORIGIN}/api/v1`;

/** Constrói um objeto Response-like que o api.ts consegue ler. */
function jsonResponse(
  body: unknown,
  init: { status?: number; ok?: boolean } = {},
): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeSession(over: Partial<AuthSession['user']> = {}): AuthSession {
  return {
    accessToken: 'tok-123',
    expiresAt: Date.now() + 600_000,
    user: {
      id: 'u1',
      email: 'a@b.com',
      nome: 'User',
      role: 'ADMIN',
      empresaIds: ['emp-1'],
      empresaIdAtiva: 'emp-1',
      ...over,
    },
  };
}

/** Último conjunto de headers passado pro fetch. */
function lastFetchHeaders(): Record<string, string> {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const init = calls[calls.length - 1][1] as RequestInit;
  return init.headers as Record<string, string>;
}

function lastFetchInit(): RequestInit {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][1] as RequestInit;
}

function lastFetchUrl(): string {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0] as string;
}

beforeEach(() => {
  // Sessão padrão: autenticada com empresa ativa.
  getSessionMock.mockReturnValue(makeSession());
  getStoredEmpresaIdMock.mockReturnValue(null);
  refreshAccessTokenMock.mockResolvedValue(null);
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─── Parsing do envelope ───────────────────────────────────────────────────

describe('envelope de sucesso', () => {
  it('{ success:true, data } → retorna apenas data', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: { id: 1, nome: 'X' }, meta: { total: 1 } }),
    );
    const out = await api.get<{ id: number; nome: string }>('/clientes');
    expect(out).toEqual({ id: 1, nome: 'X' });
  });

  it('data pode ser array', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: [1, 2, 3] }),
    );
    expect(await api.get('/x')).toEqual([1, 2, 3]);
  });

  it('body sem chave "data" → retorna o body inteiro', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ foo: 'bar' }),
    );
    expect(await api.get('/x')).toEqual({ foo: 'bar' });
  });

  it('data presente mesmo se null → retorna null (data in body)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: null }),
    );
    expect(await api.get('/x')).toBeNull();
  });

  it('204 No Content → undefined sem ler body', async () => {
    const res = jsonResponse(undefined, { status: 204 });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
    expect(await api.delete('/x/1')).toBeUndefined();
  });
});

describe('envelope de erro → ApiError', () => {
  it('{ success:false, error:{code,message} } → lança ApiError com code/message/status', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'NOT_FOUND', message: 'Cliente não existe' } },
        { status: 404 },
      ),
    );
    await expect(api.get('/clientes/999')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Cliente não existe',
    });
  });

  it('erro é instância de ApiError', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: { code: 'BAD', message: 'ruim' } }, { status: 400 }),
    );
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('5xx sem envelope válido → code UNKNOWN_ERROR e message fallback HTTP', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({}, { status: 500 }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 500,
      code: 'UNKNOWN_ERROR',
      message: 'HTTP 500',
    });
  });

  it('json inválido no corpo de erro → ainda lança ApiError com fallback', async () => {
    const res = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response;
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 500,
      code: 'UNKNOWN_ERROR',
    });
  });

  it('propaga details do envelope', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Dados inválidos',
            details: [{ field: 'nome', message: 'obrigatório' }],
          },
        },
        { status: 422 },
      ),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'nome', message: 'obrigatório' }],
    });
  });
});

describe('403 → ApiError FORBIDDEN', () => {
  it('extrai code/message do envelope (default FORBIDDEN / Acesso negado)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({}, { status: 403 }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Acesso negado',
    });
  });

  it('usa code/message vindos do backend quando presentes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        { error: { code: 'EMPRESA_REQUIRED', message: 'Empresa não definida' } },
        { status: 403 },
      ),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 403,
      code: 'EMPRESA_REQUIRED',
      message: 'Empresa não definida',
    });
  });
});

// ─── Métodos HTTP ──────────────────────────────────────────────────────────

describe('métodos get/post/put/patch/delete', () => {
  beforeEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: { ok: true } }),
    );
  });

  it('get → method GET, sem body', async () => {
    await api.get('/recurso');
    const init = lastFetchInit();
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(lastFetchUrl()).toBe(`${BASE}/recurso`);
  });

  it('post → method POST e serializa body em JSON', async () => {
    await api.post('/recurso', { nome: 'Novo' });
    const init = lastFetchInit();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ nome: 'Novo' }));
  });

  it('put → method PUT', async () => {
    await api.put('/recurso/1', { nome: 'Edit' });
    expect(lastFetchInit().method).toBe('PUT');
    expect(lastFetchInit().body).toBe(JSON.stringify({ nome: 'Edit' }));
  });

  it('patch → method PATCH', async () => {
    await api.patch('/recurso/1', { ativo: false });
    expect(lastFetchInit().method).toBe('PATCH');
    expect(lastFetchInit().body).toBe(JSON.stringify({ ativo: false }));
  });

  it('delete → method DELETE, sem body', async () => {
    await api.delete('/recurso/1');
    const init = lastFetchInit();
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('path sem barra inicial recebe / automático', async () => {
    await api.get('recurso');
    expect(lastFetchUrl()).toBe(`${BASE}/recurso`);
  });

  it('URL absoluta (http) é usada sem prefixo da API', async () => {
    await api.get('http://outro.com/health');
    expect(lastFetchUrl()).toBe('http://outro.com/health');
  });

  it('todas as chamadas usam credentials include e cache no-store', async () => {
    await api.get('/x');
    const init = lastFetchInit();
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
  });
});

// ─── Headers automáticos ────────────────────────────────────────────────────

describe('headers automáticos', () => {
  beforeEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: {} }),
    );
  });

  it('Authorization Bearer + X-Empresa-Id quando há sessão', async () => {
    await api.get('/x');
    const h = lastFetchHeaders();
    expect(h['Authorization']).toBe('Bearer tok-123');
    expect(h['X-Empresa-Id']).toBe('emp-1');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('sem sessão → sem Authorization e sem X-Empresa-Id', async () => {
    getSessionMock.mockReturnValue(null);
    getStoredEmpresaIdMock.mockReturnValue(null);
    await api.get('/x');
    const h = lastFetchHeaders();
    expect(h['Authorization']).toBeUndefined();
    expect(h['X-Empresa-Id']).toBeUndefined();
  });

  it('X-Empresa-Id cai no localStorage quando sessão não tem empresa ativa', async () => {
    getSessionMock.mockReturnValue(makeSession({ empresaIdAtiva: null }));
    getStoredEmpresaIdMock.mockReturnValue('emp-stored');
    await api.get('/x');
    expect(lastFetchHeaders()['X-Empresa-Id']).toBe('emp-stored');
  });

  it('override empresaId via opts tem prioridade sobre sessão', async () => {
    getSessionMock.mockReturnValue(makeSession({ empresaIdAtiva: 'emp-1' }));
    await api.get('/x', { empresaId: 'emp-override' });
    expect(lastFetchHeaders()['X-Empresa-Id']).toBe('emp-override');
  });

  it('skipAuth → sem Authorization mesmo com sessão', async () => {
    await api.get('/health', { skipAuth: true });
    const h = lastFetchHeaders();
    expect(h['Authorization']).toBeUndefined();
    expect(h['X-Empresa-Id']).toBeUndefined();
  });

  it('sessão sem accessToken → sem Authorization mas X-Empresa-Id ainda vai', async () => {
    getSessionMock.mockReturnValue({
      ...makeSession(),
      accessToken: '',
    });
    await api.get('/x');
    const h = lastFetchHeaders();
    expect(h['Authorization']).toBeUndefined();
    expect(h['X-Empresa-Id']).toBe('emp-1');
  });
});

// ─── Timeout (AbortController) ──────────────────────────────────────────────

describe('timeout', () => {
  it('aborta após TIMEOUT_MS e lança ApiError TIMEOUT com status 0', async () => {
    vi.useFakeTimers();
    // fetch que rejeita com AbortError quando o signal abortar.
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const promise = api.get('/lento');
    // Anexa o handler de rejeição ANTES de avançar o timer pra não gerar
    // "unhandled rejection" (a rejeição acontece dentro do advanceTimers).
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'TIMEOUT',
    });
    // Dispara o timer de timeout (GET = 10s).
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('GET usa timeout de 10s (não aborta antes disso)', async () => {
    vi.useFakeTimers();
    let aborted = false;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((resolve) => {
          (init.signal as AbortSignal).addEventListener('abort', () => {
            aborted = true;
          });
          // resolve só se ninguém abortou ainda
          setTimeout(() => resolve(jsonResponse({ success: true, data: 1 })), 0);
        }),
    );
    const p = api.get('/x');
    await vi.advanceTimersByTimeAsync(9_000);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // deixa o fetch resolver
    await p;
  });

  it('timeoutMs custom é respeitado', async () => {
    vi.useFakeTimers();
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const p = api.get('/x', { timeoutMs: 500 });
    const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });
});

describe('erro de rede (não-abort)', () => {
  it('fetch rejeita com erro genérico → ApiError NETWORK_ERROR status 0', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('conn reset'));
    await expect(api.get('/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'conn reset',
    });
  });
});

// ─── Refresh on 401 ─────────────────────────────────────────────────────────

describe('refresh-on-401', () => {
  it('1ª req 401 → chama refresh → se ok, retry uma vez e retorna data', async () => {
    const ok = jsonResponse({ success: true, data: { v: 42 } });
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(ok);
    // refresh retorna uma sessão (truthy) → habilita o retry.
    refreshAccessTokenMock.mockResolvedValue(makeSession());

    const out = await api.get<{ v: number }>('/protegido');

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ v: 42 });
  });

  it('refresh falha (null) → clearSession + ApiError AUTH_REQUIRED 401, sem retry', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({}, { status: 401 }),
    );
    refreshAccessTokenMock.mockResolvedValue(null);

    await expect(api.get('/protegido')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    });
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    // só a request original (refresh falhou, sem retry)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('não há refresh-loop: se o retry também der 401 → AUTH_REQUIRED, refresh chamado uma vez', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({}, { status: 401 }),
    );
    refreshAccessTokenMock.mockResolvedValue(makeSession());

    await expect(api.get('/protegido')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    });
    // refresh só na 1ª passagem; a 2ª (retryWithRefresh=false) não chama de novo
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(clearSessionMock).toHaveBeenCalled();
  });

  it('skipAuth + 401 → não tenta refresh, lança AUTH_REQUIRED direto', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({}, { status: 401 }),
    );
    await expect(api.get('/x', { skipAuth: true })).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    });
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
    expect(clearSessionMock).toHaveBeenCalled();
  });

  it('retry após refresh reenvia a mesma request (mesma URL/method)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 'ok' }));
    refreshAccessTokenMock.mockResolvedValue(makeSession());

    await api.post('/salvar', { a: 1 });

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    // ambas POST pra mesma URL
    expect(calls[0][0]).toBe(`${BASE}/salvar`);
    expect(calls[1][0]).toBe(`${BASE}/salvar`);
    expect((calls[0][1] as RequestInit).method).toBe('POST');
    expect((calls[1][1] as RequestInit).method).toBe('POST');
  });
});

// ─── apiErrorMessage (helper de mensagem amigável) ──────────────────────────

describe('apiErrorMessage', () => {
  it('VALIDATION_ERROR com details → "campo: mensagem"', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Dados inválidos', [
      { field: 'email', message: 'inválido' },
    ]);
    expect(apiErrorMessage(err)).toBe('email: inválido');
  });

  it('VALIDATION_ERROR só com message no detail → retorna a message', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Dados inválidos', [
      { message: 'campo obrigatório' },
    ]);
    expect(apiErrorMessage(err)).toBe('campo obrigatório');
  });

  it('ApiError comum → retorna a message', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Não encontrado');
    expect(apiErrorMessage(err)).toBe('Não encontrado');
  });

  it('Error não-Api → retorna message', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('valor não-Error → "Erro desconhecido"', () => {
    expect(apiErrorMessage('string solta')).toBe('Erro desconhecido');
  });
});
