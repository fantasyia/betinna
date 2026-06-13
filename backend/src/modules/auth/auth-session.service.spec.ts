import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@shared/errors/app-exception';
import { AuthSessionService } from './auth-session.service';

// ---------------------------------------------------------------------------
// Mock do supabase-js — o construtor chama createClient(). Expomos o
// `updateUserById` pra assertar que a senha NÃO é trocada quando recusado.
// ---------------------------------------------------------------------------
const { mockUpdateUserById } = vi.hoisted(() => ({
  mockUpdateUserById: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { updateUserById: mockUpdateUserById } },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPA_USER = { id: 'user-uuid-123', email: 'rep@empresa.com' };

const makeEnv = () => ({
  get: vi.fn((k: string): string => {
    const defaults: Record<string, string> = {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_ANON_KEY: 'anon-key',
      NODE_ENV: 'test',
    };
    return defaults[k] ?? '';
  }),
});

const makePrisma = () => ({
  usuario: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  },
});

/** fetch que roteia por URL: GET /auth/v1/user e POST token (login). */
const makeFetch = (opts: { userOk?: boolean } = {}) =>
  vi.fn(async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return {
        ok: opts.userOk ?? true,
        json: async () => SUPA_USER,
      } as Response;
    }
    if (u.includes('grant_type=password')) {
      // login() chamado só quando o welcome é APROVADO
      return {
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_at: 1_800_000_000,
          user: { id: SUPA_USER.id },
        }),
      } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  });

const makeRes = () => ({ cookie: vi.fn(), clearCookie: vi.fn() }) as never;

const TOKEN = 'a'.repeat(40); // ≥20 chars pra passar a validação de formato
const PASSWORD = 'novaSenha123';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthSessionService.welcomeFinalize — gate de segurança', () => {
  let env: ReturnType<typeof makeEnv>;
  let prisma: ReturnType<typeof makePrisma>;
  let service: AuthSessionService;

  beforeEach(() => {
    env = makeEnv();
    prisma = makePrisma();
    service = new AuthSessionService(env as never, prisma as never);
    mockUpdateUserById.mockReset();
    mockUpdateUserById.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('RECUSA trocar a senha de uma conta JÁ ATIVA (anti-sequestro)', async () => {
    vi.stubGlobal('fetch', makeFetch());
    prisma.usuario.findUnique.mockResolvedValue({ status: 'ATIVO' });

    await expect(service.welcomeFinalize(TOKEN, PASSWORD, makeRes())).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // O essencial: a senha NUNCA foi alterada no Supabase.
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('RECUSA quando não há Usuario correspondente (sem conta pendente)', async () => {
    vi.stubGlobal('fetch', makeFetch());
    prisma.usuario.findUnique.mockResolvedValue(null);

    await expect(service.welcomeFinalize(TOKEN, PASSWORD, makeRes())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('PERMITE finalizar quando a conta está PENDENTE (convite legítimo)', async () => {
    vi.stubGlobal('fetch', makeFetch());
    prisma.usuario.findUnique.mockResolvedValue({ status: 'PENDENTE' });

    const result = await service.welcomeFinalize(TOKEN, PASSWORD, makeRes());

    expect(mockUpdateUserById).toHaveBeenCalledWith(SUPA_USER.id, {
      password: PASSWORD,
      email_confirm: true,
    });
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: SUPA_USER.id },
      data: { status: 'ATIVO' },
    });
    expect(result.accessToken).toBe('new-access');
  });
});
