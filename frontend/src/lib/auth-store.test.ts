import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuthSession, AuthenticatedUser } from '@/types/auth';

/**
 * Testes do auth-store — o módulo que guarda o access token em MEMÓRIA e
 * agenda o refresh transparente. Se isto quebrar, o usuário cai pra login
 * do nada (sessão some) ou fica sem refresh (sessão expira no meio do uso),
 * ou o header X-Empresa-Id some e vira 403 — tudo custo de confiança direto.
 *
 * Como o módulo tem ESTADO de módulo (a `session` viva), usamos
 * `vi.resetModules()` + import dinâmico em cada teste pra começar limpo.
 * O `setSentryUser` é mockado pra isolar (não queremos tocar @sentry/react).
 */

// Mock do sentry — só precisamos que setSentryUser não exploda.
const setSentryUserMock = vi.fn();
vi.mock('./sentry', () => ({
  setSentryUser: (id: string | null) => setSentryUserMock(id),
}));

// ─── Helpers de fixture ──────────────────────────────────────────────────

function makeUser(over: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'u@x.com',
    nome: 'User',
    role: 'GERENTE',
    empresaIds: ['emp-a', 'emp-b'],
    empresaIdAtiva: 'emp-a',
    ...over,
  };
}

function makeSession(over: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: 'tok-123',
    user: makeUser(over.user),
    // bem no futuro pra não disparar refresh imediato por padrão
    expiresAt: Date.now() + 60 * 60 * 1000,
    ...over,
  };
}

/** Importa o módulo fresco (estado de módulo zerado). */
async function loadStore() {
  vi.resetModules();
  return import('./auth-store');
}

// Chave canônica atual do auth-store (antes era 'betinna.empresaAtiva' com ponto;
// virou ':' e o ponto ficou só como leitura legada). O teste seguia no ponto → lia null.
const EMPRESA_KEY = 'betinna:empresaAtiva';

beforeEach(() => {
  setSentryUserMock.mockClear();
  window.localStorage.clear();
  // garante fetch mockado por padrão (clearSession dispara signout em background)
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── getSession / setSession ───────────────────────────────────────────────

describe('getSession / setSession', () => {
  it('começa sem sessão', async () => {
    const store = await loadStore();
    expect(store.getSession()).toBeNull();
  });

  it('setSession guarda a sessão e getSession a retorna', async () => {
    const store = await loadStore();
    const s = makeSession();
    store.setSession(s);
    expect(store.getSession()).toBe(s);
  });

  it('setSession(null) limpa', async () => {
    const store = await loadStore();
    store.setSession(makeSession());
    store.setSession(null);
    expect(store.getSession()).toBeNull();
  });

  it('chama setSentryUser com o id do user (sem PII)', async () => {
    const store = await loadStore();
    store.setSession(makeSession({ user: makeUser({ id: 'abc' }) }));
    expect(setSentryUserMock).toHaveBeenCalledWith('abc');
  });

  it('setSession(null) chama setSentryUser(null)', async () => {
    const store = await loadStore();
    store.setSession(null);
    expect(setSentryUserMock).toHaveBeenLastCalledWith(null);
  });

  it('persiste empresaIdAtiva em localStorage ao setar sessão', async () => {
    const store = await loadStore();
    store.setSession(makeSession({ user: makeUser({ empresaIdAtiva: 'emp-b' }) }));
    expect(window.localStorage.getItem(EMPRESA_KEY)).toBe('emp-b');
  });

  it('NÃO sobrescreve empresa persistida quando a sessão não tem empresa ativa', async () => {
    const store = await loadStore();
    window.localStorage.setItem(EMPRESA_KEY, 'emp-x');
    store.setSession(makeSession({ user: makeUser({ empresaIdAtiva: null }) }));
    // setStoredEmpresaId só grava quando há id; null não apaga o que já existe
    expect(window.localStorage.getItem(EMPRESA_KEY)).toBe('emp-x');
  });
});

// ─── currentRole / currentEmpresaId ─────────────────────────────────────────

describe('currentRole / currentEmpresaId', () => {
  it('retornam null sem sessão', async () => {
    const store = await loadStore();
    expect(store.currentRole()).toBeNull();
    expect(store.currentEmpresaId()).toBeNull();
  });

  it('refletem o user da sessão', async () => {
    const store = await loadStore();
    store.setSession(makeSession({ user: makeUser({ role: 'ADMIN', empresaIdAtiva: 'emp-z' }) }));
    expect(store.currentRole()).toBe('ADMIN');
    expect(store.currentEmpresaId()).toBe('emp-z');
  });

  it('currentEmpresaId é null quando empresaIdAtiva é null', async () => {
    const store = await loadStore();
    store.setSession(makeSession({ user: makeUser({ empresaIdAtiva: null }) }));
    expect(store.currentEmpresaId()).toBeNull();
  });
});

// ─── getStoredEmpresaId ──────────────────────────────────────────────────────

describe('getStoredEmpresaId', () => {
  it('null quando nada persistido', async () => {
    const store = await loadStore();
    expect(store.getStoredEmpresaId()).toBeNull();
  });

  it('lê o valor persistido', async () => {
    const store = await loadStore();
    window.localStorage.setItem(EMPRESA_KEY, 'emp-stored');
    expect(store.getStoredEmpresaId()).toBe('emp-stored');
  });

  it('não explode se localStorage.getItem lançar (retorna null)', async () => {
    const store = await loadStore();
    const spy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('no storage');
    });
    expect(store.getStoredEmpresaId()).toBeNull();
    spy.mockRestore();
  });
});

// ─── clearSession ────────────────────────────────────────────────────────────

describe('clearSession', () => {
  it('zera a sessão e remove a empresa persistida', async () => {
    const store = await loadStore();
    store.setSession(makeSession());
    expect(window.localStorage.getItem(EMPRESA_KEY)).toBe('emp-a');
    store.clearSession();
    expect(store.getSession()).toBeNull();
    expect(window.localStorage.getItem(EMPRESA_KEY)).toBeNull();
  });

  it('dispara POST /auth/signout com credentials include', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    store.clearSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/auth/signout');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  it('não propaga erro se o signout fetch rejeitar (best-effort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    );
    const store = await loadStore();
    expect(() => store.clearSession()).not.toThrow();
  });
});

// ─── subscribe / subscribeInitializing ───────────────────────────────────────

describe('subscribe', () => {
  it('chama o listener imediatamente com o estado atual', async () => {
    const store = await loadStore();
    const s = makeSession();
    store.setSession(s);
    const cb = vi.fn();
    store.subscribe(cb);
    expect(cb).toHaveBeenCalledWith(s);
  });

  it('notifica em mudanças de sessão', async () => {
    const store = await loadStore();
    const cb = vi.fn();
    store.subscribe(cb);
    cb.mockClear();
    const s = makeSession();
    store.setSession(s);
    expect(cb).toHaveBeenCalledWith(s);
  });

  it('unsubscribe para de notificar', async () => {
    const store = await loadStore();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    cb.mockClear();
    off();
    store.setSession(makeSession());
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('subscribeInitializing / isInitializing', () => {
  it('começa inicializando', async () => {
    const store = await loadStore();
    expect(store.isInitializing()).toBe(true);
  });

  it('listener recebe o estado atual na hora', async () => {
    const store = await loadStore();
    const cb = vi.fn();
    store.subscribeInitializing(cb);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('bootstrap zera initializing e notifica false', async () => {
    // refresh falha (não-ok) → sessão null, mas initializing deve virar false
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    const store = await loadStore();
    const cb = vi.fn();
    store.subscribeInitializing(cb);
    cb.mockClear();
    await store.bootstrapAuthFromBackend();
    expect(store.isInitializing()).toBe(false);
    expect(cb).toHaveBeenCalledWith(false);
  });
});

// ─── switchEmpresaAtiva ──────────────────────────────────────────────────────

describe('switchEmpresaAtiva', () => {
  // jsdom não implementa reload; mockamos pra não explodir e poder asserir.
  let reloadSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
  });

  it('não faz nada sem sessão', async () => {
    const store = await loadStore();
    store.switchEmpresaAtiva('emp-b');
    expect(store.getSession()).toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('troca empresa válida, persiste e recarrega', async () => {
    const store = await loadStore();
    store.setSession(makeSession({ user: makeUser({ empresaIdAtiva: 'emp-a' }) }));
    store.switchEmpresaAtiva('emp-b');
    expect(store.currentEmpresaId()).toBe('emp-b');
    expect(window.localStorage.getItem(EMPRESA_KEY)).toBe('emp-b');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('no-op quando já é a empresa ativa (não recarrega)', async () => {
    const store = await loadStore();
    store.setSession(makeSession({ user: makeUser({ empresaIdAtiva: 'emp-a' }) }));
    store.switchEmpresaAtiva('emp-a');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('bloqueia empresa que não pertence ao user não-admin', async () => {
    const store = await loadStore();
    store.setSession(
      makeSession({ user: makeUser({ role: 'GERENTE', empresaIds: ['emp-a'], empresaIdAtiva: 'emp-a' }) }),
    );
    store.switchEmpresaAtiva('emp-outra');
    expect(store.currentEmpresaId()).toBe('emp-a');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('ADMIN pode trocar pra qualquer empresa (defesa em profundidade no front)', async () => {
    const store = await loadStore();
    store.setSession(
      makeSession({ user: makeUser({ role: 'ADMIN', empresaIds: ['emp-a'], empresaIdAtiva: 'emp-a' }) }),
    );
    store.switchEmpresaAtiva('emp-qualquer');
    expect(store.currentEmpresaId()).toBe('emp-qualquer');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── refreshAccessToken ──────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('refresh não-ok → seta sessão null e retorna null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}, 401))));
    const store = await loadStore();
    const result = await store.refreshAccessToken();
    expect(result).toBeNull();
    expect(store.getSession()).toBeNull();
  });

  it('refresh ok mas sem accessToken → null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ data: {} }))));
    const store = await loadStore();
    const result = await store.refreshAccessToken();
    expect(result).toBeNull();
    expect(store.getSession()).toBeNull();
  });

  it('refresh ok mas /me retorna não-ok → null', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { accessToken: 'AT', expiresAt: 123, userId: 'u' } }));
      }
      // /auth/me
      return Promise.resolve(jsonResponse({}, 500));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    const result = await store.refreshAccessToken();
    expect(result).toBeNull();
    expect(store.getSession()).toBeNull();
  });

  it('happy path: monta sessão com accessToken + user do /me', async () => {
    const me = makeUser({ id: 'u-9', role: 'GERENTE', empresaIds: ['emp-a'], empresaIdAtiva: null });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { accessToken: 'AT-new', expiresAt: 999, userId: 'u-9' } }));
      }
      return Promise.resolve(jsonResponse({ data: me }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    const result = await store.refreshAccessToken();
    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe('AT-new');
    expect(result?.expiresAt).toBe(999);
    expect(result?.user.id).toBe('u-9');
    expect(store.getSession()).toBe(result);
  });

  it('manda Bearer token no /me e credentials include no /refresh', async () => {
    const me = makeUser();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { accessToken: 'AT-x', expiresAt: 999, userId: 'u' } }));
      }
      return Promise.resolve(jsonResponse({ data: me }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    await store.refreshAccessToken();
    const refreshCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/auth/refresh'));
    const meCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/auth/me'));
    expect(refreshCall?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect((meCall?.[1] as RequestInit)?.headers).toMatchObject({ Authorization: 'Bearer AT-x' });
  });

  it('reaplica empresa persistida se válida pro user', async () => {
    const me = makeUser({ role: 'GERENTE', empresaIds: ['emp-a', 'emp-b'], empresaIdAtiva: 'emp-a' });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { accessToken: 'AT', expiresAt: 999, userId: 'u' } }));
      }
      return Promise.resolve(jsonResponse({ data: me }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    window.localStorage.setItem(EMPRESA_KEY, 'emp-b');
    const result = await store.refreshAccessToken();
    // empresa persistida (emp-b) pertence ao user → vence a do /me (emp-a)
    expect(result?.user.empresaIdAtiva).toBe('emp-b');
  });

  it('NÃO reaplica empresa persistida que não pertence ao user', async () => {
    const me = makeUser({ role: 'GERENTE', empresaIds: ['emp-a'], empresaIdAtiva: 'emp-a' });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { accessToken: 'AT', expiresAt: 999, userId: 'u' } }));
      }
      return Promise.resolve(jsonResponse({ data: me }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    window.localStorage.setItem(EMPRESA_KEY, 'emp-intrusa');
    const result = await store.refreshAccessToken();
    expect(result?.user.empresaIdAtiva).toBe('emp-a');
  });

  it('ADMIN reaplica qualquer empresa persistida', async () => {
    const me = makeUser({ role: 'ADMIN', empresaIds: ['emp-a'], empresaIdAtiva: 'emp-a' });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { accessToken: 'AT', expiresAt: 999, userId: 'u' } }));
      }
      return Promise.resolve(jsonResponse({ data: me }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    window.localStorage.setItem(EMPRESA_KEY, 'emp-z');
    const result = await store.refreshAccessToken();
    expect(result?.user.empresaIdAtiva).toBe('emp-z');
  });

  it('fetch lançando exceção → null (não propaga)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
    const store = await loadStore();
    const result = await store.refreshAccessToken();
    expect(result).toBeNull();
    expect(store.getSession()).toBeNull();
  });
});

// ─── bootstrapAuthFromBackend ────────────────────────────────────────────────

describe('bootstrapAuthFromBackend', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('retorna a sessão quando refresh tem sucesso e zera initializing', async () => {
    const me = makeUser();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { accessToken: 'AT', expiresAt: 999, userId: 'u' } }));
      }
      return Promise.resolve(jsonResponse({ data: me }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();
    const result = await store.bootstrapAuthFromBackend();
    expect(result?.accessToken).toBe('AT');
    expect(store.isInitializing()).toBe(false);
  });

  it('zera initializing mesmo quando refresh falha', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('x'))));
    const store = await loadStore();
    const result = await store.bootstrapAuthFromBackend();
    expect(result).toBeNull();
    expect(store.isInitializing()).toBe(false);
  });
});

// ─── Agendamento do refresh transparente (timers) ────────────────────────────

describe('scheduleRefresh (timer)', () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('agenda timer ~60s antes do exp e dispara refresh ao expirar', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 401)));
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    // expira em 5 min; margem é 60s; now=0 → msUntil = 300s - 60s = 240s (4min)
    store.setSession(makeSession({ expiresAt: 5 * 60_000 }));
    expect(fetchMock).not.toHaveBeenCalled();

    // avança até 1ms antes do disparo (4min) — ainda nada
    vi.advanceTimersByTime(4 * 60_000 - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    // cruza o limite (4min) → dispara o refresh
    vi.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/auth/refresh');
  });

  it('token já expirado/perto → refresh imediato (sem timer)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 401)));
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    // expiresAt no passado → msUntil <= 0 → refresh síncrono na hora
    store.setSession(makeSession({ expiresAt: 500_000 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/refresh');
  });

  it('setSession(null) cancela o timer pendente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 401)));
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    store.setSession(makeSession({ expiresAt: 5 * 60_000 }));
    store.setSession(null);
    vi.advanceTimersByTime(10 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nova sessão re-agenda (cancela o timer antigo — só um refresh dispara)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 401)));
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    store.setSession(makeSession({ expiresAt: 5 * 60_000 }));
    // re-seta com novo exp antes do primeiro disparar
    store.setSession(makeSession({ expiresAt: 10 * 60_000 }));

    // avança até depois do PRIMEIRO timer (4min) — não deve disparar (foi cancelado)
    vi.advanceTimersByTime(4 * 60_000 + 1_000);
    expect(fetchMock).not.toHaveBeenCalled();

    // avança até o SEGUNDO timer (9min) → dispara uma vez
    vi.advanceTimersByTime(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clearSession cancela o timer agendado', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 200)));
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    store.setSession(makeSession({ expiresAt: 5 * 60_000 }));
    fetchMock.mockClear(); // ignora o signout abaixo
    store.clearSession();
    // o signout fetch dispara 1x; mas o timer de refresh NÃO
    const refreshCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/auth/refresh'),
    ).length;
    vi.advanceTimersByTime(10 * 60_000);
    const refreshCallsAfter = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/auth/refresh'),
    ).length;
    expect(refreshCallsAfter).toBe(refreshCallsBefore);
  });

  it('sessão sem expiresAt não agenda timer', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({}, 401)));
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadStore();

    // expiresAt = 0 é falsy → scheduleRefresh retorna cedo
    store.setSession(makeSession({ expiresAt: 0 }));
    vi.advanceTimersByTime(60 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
