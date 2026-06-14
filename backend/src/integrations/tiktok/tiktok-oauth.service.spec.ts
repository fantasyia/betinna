import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { TikTokOAuthService } from './tiktok-oauth.service';

const makeEnvMock = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string) => {
    const d: Record<string, string> = {
      ENCRYPTION_KEY: '0'.repeat(64),
      TIKTOK_APP_KEY: 'app-k',
      TIKTOK_APP_SECRET: 'app-s',
      TIKTOK_SERVICE_ID: 'svc-1',
      TIKTOK_REDIRECT_URI: 'https://app.com/cb',
      ...overrides,
    };
    return d[k] ?? '';
  }),
});

const makeHttpMock = () => ({ get: vi.fn() });

const makePrismaMock = () => ({
  integracaoConexao: {
    findFirst: vi.fn(),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
});

const makeIntegracoesMock = () => ({
  obterCredenciaisInternas: vi.fn(),
  salvarCredenciaisInternas: vi.fn().mockResolvedValue(undefined),
  registrarSyncOk: vi.fn().mockResolvedValue({}),
});

describe('TikTokOAuthService', () => {
  let env: ReturnType<typeof makeEnvMock>;
  let http: ReturnType<typeof makeHttpMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let service: TikTokOAuthService;

  beforeEach(() => {
    env = makeEnvMock();
    http = makeHttpMock();
    prisma = makePrismaMock();
    integracoes = makeIntegracoesMock();
    service = new TikTokOAuthService(
      env as never,
      http as never,
      prisma as never,
      integracoes as never,
    );
  });

  describe('isConfigured', () => {
    it('true quando todas as env vars presentes', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('false quando TIKTOK_APP_KEY ausente', () => {
      const svc = new TikTokOAuthService(
        makeEnvMock({ TIKTOK_APP_KEY: '' }) as never,
        http as never,
        prisma as never,
        integracoes as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it('false quando TIKTOK_SERVICE_ID ausente', () => {
      const svc = new TikTokOAuthService(
        makeEnvMock({ TIKTOK_SERVICE_ID: '' }) as never,
        http as never,
        prisma as never,
        integracoes as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe('buildAuthUrl', () => {
    it('lança IntegrationException quando não configurado', async () => {
      const svc = new TikTokOAuthService(
        makeEnvMock({ TIKTOK_APP_KEY: '' }) as never,
        http as never,
        prisma as never,
        integracoes as never,
      );

      await expect(svc.buildAuthUrl('emp-1')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('inclui service_id e state na URL', async () => {
      const url = await service.buildAuthUrl('emp-1');

      expect(url).toContain('service_id=svc-1');
      expect(url).toContain('state=');
    });
  });

  describe('getCredenciais — refresh transparente', () => {
    const now = Date.now();

    it('retorna credenciais quando ainda válidas', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok-valid',
          refreshToken: 'rt',
          shopId: 'shop-1',
          shopCipher: 'cipher',
          expiresAt: now + 3600_000,
        },
      });

      const r = await service.getCredenciais('emp-1');

      expect(r.accessToken).toBe('tok-valid');
      expect(http.get).not.toHaveBeenCalled();
    });

    it('refresh quando expira em <60s', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok-old',
          refreshToken: 'rt',
          shopId: 'shop-1',
          shopCipher: 'cipher',
          expiresAt: now + 30_000,
        },
      });
      http.get.mockResolvedValue({
        data: {
          code: 0,
          data: {
            access_token: 'tok-new',
            refresh_token: 'rt-new',
            access_token_expire_in: 7200,
            refresh_token_expire_in: 31536000,
          },
        },
      });

      const r = await service.getCredenciais('emp-1');

      expect(r.accessToken).toBe('tok-new');
      expect(http.get).toHaveBeenCalled();
    });

    it('lança IntegrationException quando credenciais incompletas', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { accessToken: 'tok' }, // sem refreshToken/shopId
      });

      await expect(service.getCredenciais('emp-1')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('lança quando refresh retorna code != 0', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok',
          refreshToken: 'rt',
          shopId: 'shop-1',
          shopCipher: 'cipher',
          expiresAt: now - 1000,
        },
      });
      http.get.mockResolvedValue({
        data: { code: 36004001, message: 'refresh_token expired' },
      });

      await expect(service.getCredenciais('emp-1')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('preserva refreshToken quando refresh não devolve novo', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok',
          refreshToken: 'rt-old',
          shopId: 'shop-1',
          shopCipher: 'cipher',
          expiresAt: now - 1000,
        },
      });
      http.get.mockResolvedValue({
        data: {
          code: 0,
          data: {
            access_token: 'tok-new',
            access_token_expire_in: 7200,
            // sem refresh_token
          },
        },
      });

      const r = await service.getCredenciais('emp-1');

      expect(r.refreshToken).toBe('rt-old');
    });
  });

  describe('resolverPorShopId', () => {
    it('retorna empresaId quando shop encontrado', async () => {
      prisma.integracaoConexao.findFirst.mockResolvedValue({ empresaId: 'emp-1' });

      const r = await service.resolverPorShopId('shop-1');

      expect(r).toBe('emp-1');
      expect(prisma.integracaoConexao.findFirst).toHaveBeenCalledWith({
        where: { servico: 'tiktok', externalAccountId: 'shop-1', ativo: true },
        select: { empresaId: true },
      });
    });

    it('retorna null quando shop não encontrado', async () => {
      prisma.integracaoConexao.findFirst.mockResolvedValue(null);

      expect(await service.resolverPorShopId('shop-x')).toBeNull();
    });
  });
});
