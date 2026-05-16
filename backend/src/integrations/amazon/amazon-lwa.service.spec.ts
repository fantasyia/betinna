import { describe, expect, it, vi } from 'vitest';
import { IntegrationException, UnauthorizedException } from '@shared/errors/app-exception';
import { AmazonLwaService } from './amazon-lwa.service';

const ENC_KEY = 'a'.repeat(64);

const makeEnv = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      ENCRYPTION_KEY: ENC_KEY,
      AMAZON_CLIENT_ID: 'amzn-cid',
      AMAZON_CLIENT_SECRET: 'amzn-csec',
      AMAZON_APP_ID: 'amzn-app-id',
      AMAZON_LWA_REDIRECT_URI: 'http://localhost:3001/cb',
      AMAZON_OAUTH_HOST: 'sellercentral.amazon.com.br',
      AMAZON_MARKETPLACE_ID: 'A2Q3Y263D00KWC',
      ...overrides,
    };
    return map[k] ?? '';
  }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeHttp = (): { post: any } => ({ post: vi.fn() });
const makePrisma = () => ({
  integracaoConexao: {
    upsert: vi.fn(async () => ({})),
    findFirst: vi.fn(),
  },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeIntegracoes = (): { obterCredenciaisInternas: any; registrarSyncOk: any } => ({
  obterCredenciaisInternas: vi.fn(),
  registrarSyncOk: vi.fn(async () => undefined),
});

describe('AmazonLwaService.buildAuthUrl', () => {
  it('inclui application_id + state + version=beta quando configurado', async () => {
    const svc = new AmazonLwaService(
      makeEnv() as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    expect(url).toContain('sellercentral.amazon.com.br');
    expect(url).toContain('application_id=amzn-app-id');
    expect(url).toContain('version=beta');
    expect(url).toContain('state=');
  });

  it('falha quando AMAZON_APP_ID ausente', async () => {
    const svc = new AmazonLwaService(
      makeEnv({ AMAZON_APP_ID: '' }) as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    await expect(svc.buildAuthUrl('emp-1')).rejects.toBeInstanceOf(IntegrationException);
  });
});

describe('AmazonLwaService.processCallback', () => {
  it('roundtrip: troca spapi_oauth_code por refresh+access, persiste com externalAccountId', async () => {
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'at-1',
        refresh_token: 'rt-1',
        token_type: 'bearer',
        expires_in: 3600,
      },
    });
    const prisma = makePrisma();
    const svc = new AmazonLwaService(
      makeEnv() as never,
      http as never,
      prisma as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;
    const r = await svc.processCallback('code-x', 'A2L3F4ABCDEF', state);
    expect(r.empresaId).toBe('emp-1');
    expect(r.sellingPartnerId).toBe('A2L3F4ABCDEF');
    expect(prisma.integracaoConexao.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          servico: 'amazon',
          externalAccountId: 'A2L3F4ABCDEF',
        }),
      }),
    );
  });

  it('rejeita quando token endpoint não retorna refresh_token', async () => {
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'at-1',
        // sem refresh_token
        token_type: 'bearer',
        expires_in: 3600,
      },
    });
    const svc = new AmazonLwaService(
      makeEnv() as never,
      http as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;
    await expect(svc.processCallback('c', 'A1', state)).rejects.toBeInstanceOf(
      IntegrationException,
    );
  });

  it('rejeita state assinado com outra ENCRYPTION_KEY', async () => {
    const svc1 = new AmazonLwaService(
      makeEnv() as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    const url = await svc1.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;
    const svc2 = new AmazonLwaService(
      makeEnv({ ENCRYPTION_KEY: 'b'.repeat(64) }) as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    await expect(svc2.processCallback('c', 'A1', state)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('AmazonLwaService.getCredenciais refresh', () => {
  it('retorna token sem refresh quando longe da expiração', async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: {
        sellingPartnerId: 'A1',
        accessToken: 'still-valid',
        refreshToken: 'rt',
        expiresAt: Date.now() + 5 * 60_000,
      },
    });
    const http = makeHttp();
    const svc = new AmazonLwaService(
      makeEnv() as never,
      http as never,
      makePrisma() as never,
      integ as never,
    );
    const r = await svc.getCredenciais('emp-1');
    expect(r.accessToken).toBe('still-valid');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('faz refresh e preserva refresh_token quando endpoint não devolve um novo', async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: {
        sellingPartnerId: 'A1',
        accessToken: 'expired',
        refreshToken: 'rt-original',
        expiresAt: Date.now() - 1000,
        marketplaceId: 'A2Q3Y263D00KWC',
      },
    });
    const http = makeHttp();
    http.post.mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'fresh-at',
        // sem refresh_token → preserva o original
        token_type: 'bearer',
        expires_in: 3600,
      },
    });
    const prisma = makePrisma();
    const svc = new AmazonLwaService(
      makeEnv() as never,
      http as never,
      prisma as never,
      integ as never,
    );
    const r = await svc.getCredenciais('emp-1');
    expect(r.accessToken).toBe('fresh-at');
    expect(r.refreshToken).toBe('rt-original');
    expect(prisma.integracaoConexao.upsert).toHaveBeenCalled();
  });
});
