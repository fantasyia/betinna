import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationException, UnauthorizedException } from '@shared/errors/app-exception';
import { GoogleOAuthService } from './google-oauth.service';

const ENC_KEY = 'a'.repeat(64); // 64 hex chars

const makeEnv = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      ENCRYPTION_KEY: ENC_KEY,
      GOOGLE_CLIENT_ID: 'gci',
      GOOGLE_CLIENT_SECRET: 'gcs',
      GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/v1/integracoes/google/oauth/callback',
      ...overrides,
    };
    return map[k] ?? '';
  }),
});

const makeHttp = () => ({
  post: vi.fn(),
  get: vi.fn(),
});

const makeUserIntegracoes = () => ({
  conectarInterno: vi.fn(async () => ({})),
  obterCredenciaisInternas: vi.fn(),
});

describe('GoogleOAuthService.buildAuthUrl', () => {
  it('monta URL com scope+state+prompt=consent quando configurado', async () => {
    const svc = new GoogleOAuthService(
      makeEnv() as never,
      makeHttp() as never,
      makeUserIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('u1');
    expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('client_id=gci');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('state=');
  });

  it('falha quando não configurado', async () => {
    const svc = new GoogleOAuthService(
      makeEnv({ GOOGLE_CLIENT_ID: '' }) as never,
      makeHttp() as never,
      makeUserIntegracoes() as never,
    );
    await expect(svc.buildAuthUrl('u1')).rejects.toBeInstanceOf(IntegrationException);
  });
});

describe('GoogleOAuthService state JWT (CSRF protection)', () => {
  it('state assinado por buildAuthUrl é aceito pelo exchangeCode (mesma chave)', async () => {
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: '', token_type: 'Bearer' },
    });
    http.get.mockResolvedValueOnce({ status: 200, data: { sub: 'g1', email: 'a@gmail.com' } });

    const ui = makeUserIntegracoes();
    const svc = new GoogleOAuthService(makeEnv() as never, http as never, ui as never);
    const url = await svc.buildAuthUrl('u1');
    const state = new URL(url).searchParams.get('state')!;

    const r = await svc.exchangeCode('code-x', state);
    expect(r.userId).toBe('u1');
    expect(r.email).toBe('a@gmail.com');
    expect(ui.conectarInterno).toHaveBeenCalledWith(
      'u1',
      'google_calendar',
      expect.objectContaining({ accessToken: 'at', refreshToken: 'rt', email: 'a@gmail.com' }),
    );
  });

  it('rejeita state assinado por outra ENCRYPTION_KEY', async () => {
    const svc1 = new GoogleOAuthService(
      makeEnv() as never,
      makeHttp() as never,
      makeUserIntegracoes() as never,
    );
    const url = await svc1.buildAuthUrl('u1');
    const state = new URL(url).searchParams.get('state')!;

    const otherKey = 'b'.repeat(64);
    const svc2 = new GoogleOAuthService(
      makeEnv({ ENCRYPTION_KEY: otherKey }) as never,
      makeHttp() as never,
      makeUserIntegracoes() as never,
    );
    await expect(svc2.exchangeCode('code-x', state)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita state malformado', async () => {
    const svc = new GoogleOAuthService(
      makeEnv() as never,
      makeHttp() as never,
      makeUserIntegracoes() as never,
    );
    await expect(svc.exchangeCode('code', 'not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita quando Google não devolve refresh_token', async () => {
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: { access_token: 'at', expires_in: 3600, scope: '', token_type: 'Bearer' }, // sem refresh_token
    });
    const svc = new GoogleOAuthService(
      makeEnv() as never,
      http as never,
      makeUserIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('u1');
    const state = new URL(url).searchParams.get('state')!;
    await expect(svc.exchangeCode('c', state)).rejects.toBeInstanceOf(IntegrationException);
  });
});

describe('GoogleOAuthService.getAccessToken', () => {
  it('retorna token sem refresh quando longe da expiração', async () => {
    const ui = makeUserIntegracoes();
    ui.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: {
        accessToken: 'still-valid',
        refreshToken: 'rt',
        expiresAt: Date.now() + 5 * 60_000,
      },
    });
    const http = makeHttp();
    const svc = new GoogleOAuthService(makeEnv() as never, http as never, ui as never);
    const t = await svc.getAccessToken('u1');
    expect(t).toBe('still-valid');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('faz refresh quando token está próximo de expirar', async () => {
    const ui = makeUserIntegracoes();
    ui.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: {
        accessToken: 'expired',
        refreshToken: 'rt',
        expiresAt: Date.now() - 1000, // já expirou
      },
    });
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: { access_token: 'fresh', expires_in: 3600, scope: '', token_type: 'Bearer' },
    });
    const svc = new GoogleOAuthService(makeEnv() as never, http as never, ui as never);
    const t = await svc.getAccessToken('u1');
    expect(t).toBe('fresh');
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(ui.conectarInterno).toHaveBeenCalled();
  });
});
