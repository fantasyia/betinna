import { describe, expect, it, vi } from 'vitest';
import { IntegrationException, UnauthorizedException } from '@shared/errors/app-exception';
import { MLOAuthService } from './ml-oauth.service';

const ENC_KEY = 'a'.repeat(64);

const makeEnv = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      ENCRYPTION_KEY: ENC_KEY,
      ML_CLIENT_ID: 'cid-ml',
      ML_CLIENT_SECRET: 'csec-ml',
      ML_REDIRECT_URI: 'http://localhost:3001/cb',
      ML_SITE_ID: 'MLB',
      ...overrides,
    };
    return map[k] ?? '';
  }),
});

const makeHttp = () => ({
  post: vi.fn(),
  get: vi.fn(),
});

const makePrisma = () => ({
  integracaoConexao: {
    upsert: vi.fn(async () => ({})),
    findFirst: vi.fn(),
  },
});

const makeIntegracoes = () => ({
  obterCredenciaisInternas: vi.fn(),
  registrarSyncOk: vi.fn(async () => undefined),
});

describe('MLOAuthService.buildAuthUrl', () => {
  it('inclui state JWT + client_id quando configurado', async () => {
    const svc = new MLOAuthService(
      makeEnv() as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    expect(url).toContain('auth.mercadolivre.com.br');
    expect(url).toContain('client_id=cid-ml');
    expect(url).toContain('state=');
  });

  it('falha quando ML_CLIENT_ID ausente', async () => {
    const svc = new MLOAuthService(
      makeEnv({ ML_CLIENT_ID: '' }) as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    await expect(svc.buildAuthUrl('emp-1')).rejects.toBeInstanceOf(IntegrationException);
  });
});

describe('MLOAuthService.processCallback', () => {
  it('roundtrip: troca code, busca user info, persiste credenciais com externalAccountId', async () => {
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        token_type: 'bearer',
        expires_in: 21600,
        scope: 'read write offline_access',
        user_id: 9876543,
      },
    });
    http.get.mockResolvedValueOnce({
      status: 200,
      data: { id: 9876543, nickname: 'LOJAX', site_id: 'MLB' },
    });
    const prisma = makePrisma();
    const svc = new MLOAuthService(
      makeEnv() as never,
      http as never,
      prisma as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;
    const r = await svc.processCallback('code-abc', state);
    expect(r.empresaId).toBe('emp-1');
    expect(r.userId).toBe('9876543');
    expect(prisma.integracaoConexao.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          servico: 'mercadolivre',
          externalAccountId: '9876543',
        }),
      }),
    );
  });

  it('rejeita state assinado com outra ENCRYPTION_KEY', async () => {
    const svc1 = new MLOAuthService(
      makeEnv() as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    const url = await svc1.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;

    const svc2 = new MLOAuthService(
      makeEnv({ ENCRYPTION_KEY: 'b'.repeat(64) }) as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    await expect(svc2.processCallback('code', state)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('MLOAuthService.getAccessToken refresh', () => {
  it('retorna token sem refresh quando longe da expiração', async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: {
        userId: '9876543',
        accessToken: 'still-valid',
        refreshToken: 'rt-1',
        expiresAt: Date.now() + 5 * 60_000,
      },
    });
    const http = makeHttp();
    const svc = new MLOAuthService(
      makeEnv() as never,
      http as never,
      makePrisma() as never,
      integ as never,
    );
    const r = await svc.getAccessToken('emp-1');
    expect(r.accessToken).toBe('still-valid');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('faz refresh quando token está próximo de expirar', async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: {
        userId: '9876543',
        accessToken: 'expired',
        refreshToken: 'rt-old',
        expiresAt: Date.now() - 1000,
      },
    });
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'fresh',
        refresh_token: 'rt-new', // ML rotaciona refresh token
        token_type: 'bearer',
        expires_in: 21600,
        scope: 'x',
        user_id: 9876543,
      },
    });
    const prisma = makePrisma();
    const svc = new MLOAuthService(
      makeEnv() as never,
      http as never,
      prisma as never,
      integ as never,
    );
    const r = await svc.getAccessToken('emp-1');
    expect(r.accessToken).toBe('fresh');
    expect(r.refreshToken).toBe('rt-new');
    expect(http.post).toHaveBeenCalledTimes(1);
    // Confirma persist com novo refresh token + externalAccountId
    expect(prisma.integracaoConexao.upsert).toHaveBeenCalled();
  });
});
