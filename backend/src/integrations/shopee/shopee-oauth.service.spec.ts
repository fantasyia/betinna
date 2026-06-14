import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IntegrationException } from '@shared/errors/app-exception';
import { ShopeeOAuthService } from './shopee-oauth.service';

const makeEnvMock = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string) => {
    const d: Record<string, string> = {
      ENCRYPTION_KEY: '0'.repeat(64),
      SHOPEE_PARTNER_ID: '1234567',
      SHOPEE_PARTNER_KEY: 'partner-key',
      SHOPEE_REDIRECT_URI: 'https://app.com/cb',
      SHOPEE_ENV: 'production',
      ...overrides,
    };
    return d[k] ?? '';
  }),
});

const makeHttpMock = () => ({ post: vi.fn() });

const makePrismaMock = () => ({
  integracaoConexao: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
  },
});

const makeIntegracoesMock = () => ({
  obterCredenciaisInternas: vi.fn(),
  salvarCredenciaisInternas: vi.fn().mockResolvedValue(undefined),
  registrarSyncOk: vi.fn().mockResolvedValue({}),
  registrarSyncErro: vi.fn().mockResolvedValue({}),
});

describe('ShopeeOAuthService', () => {
  let env: ReturnType<typeof makeEnvMock>;
  let http: ReturnType<typeof makeHttpMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let integracoes: ReturnType<typeof makeIntegracoesMock>;
  let service: ShopeeOAuthService;

  beforeEach(() => {
    env = makeEnvMock();
    http = makeHttpMock();
    prisma = makePrismaMock();
    integracoes = makeIntegracoesMock();
    service = new ShopeeOAuthService(
      env as never,
      http as never,
      prisma as never,
      integracoes as never,
    );
  });

  describe('isConfigured', () => {
    it('true quando todas as env vars estão presentes', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('false quando SHOPEE_PARTNER_ID ausente', () => {
      const svc = new ShopeeOAuthService(
        makeEnvMock({ SHOPEE_PARTNER_ID: '' }) as never,
        http as never,
        prisma as never,
        integracoes as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it('false quando SHOPEE_REDIRECT_URI ausente', () => {
      const svc = new ShopeeOAuthService(
        makeEnvMock({ SHOPEE_REDIRECT_URI: '' }) as never,
        http as never,
        prisma as never,
        integracoes as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe('baseUrl', () => {
    it('retorna URL de produção por default', () => {
      expect(service.baseUrl()).toBe('https://partner.shopeemobile.com');
    });

    it('retorna URL de sandbox quando SHOPEE_ENV=sandbox', () => {
      const svc = new ShopeeOAuthService(
        makeEnvMock({ SHOPEE_ENV: 'sandbox' }) as never,
        http as never,
        prisma as never,
        integracoes as never,
      );
      expect(svc.baseUrl()).toContain('test-stable');
    });
  });

  describe('buildAuthUrl', () => {
    it('lança IntegrationException quando não configurado', async () => {
      const svc = new ShopeeOAuthService(
        makeEnvMock({ SHOPEE_PARTNER_ID: '' }) as never,
        http as never,
        prisma as never,
        integracoes as never,
      );

      await expect(svc.buildAuthUrl('emp-1')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('inclui partner_id, sign, timestamp e redirect na URL', async () => {
      const url = await service.buildAuthUrl('emp-1');

      expect(url).toContain('partner_id=1234567');
      expect(url).toContain('sign=');
      expect(url).toContain('timestamp=');
      expect(url).toContain('redirect=');
    });
  });

  describe('getCredenciais — refresh transparente', () => {
    const now = Date.now();

    it('retorna credenciais existentes quando ainda válidas', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok-valid',
          refreshToken: 'rt',
          shopId: '999',
          expiresAt: now + 3600_000, // 1h ahead
        },
      });

      const r = await service.getCredenciais('emp-1');

      expect(r.accessToken).toBe('tok-valid');
      // Não deve ter chamado refresh
      expect(http.post).not.toHaveBeenCalled();
    });

    it('refresh quando expira em menos de TOKEN_REFRESH_MARGIN_MS (60s)', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok-expiring',
          refreshToken: 'rt',
          shopId: '999',
          expiresAt: now + 30_000, // 30s ahead → vai refresh
        },
      });
      http.post.mockResolvedValue({
        data: {
          access_token: 'tok-new',
          refresh_token: 'rt-new',
          expire_in: 14400,
        },
      });

      const r = await service.getCredenciais('emp-1');

      expect(r.accessToken).toBe('tok-new');
      expect(http.post).toHaveBeenCalled();
    });

    it('lança IntegrationException quando credenciais incompletas', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: { accessToken: 'tok' }, // sem refreshToken/shopId/expiresAt
      });

      await expect(service.getCredenciais('emp-1')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('lança IntegrationException quando refresh não retorna access_token', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok',
          refreshToken: 'rt',
          shopId: '999',
          expiresAt: now - 1000, // já expirado
        },
      });
      http.post.mockResolvedValue({
        data: { error: 'invalid_refresh_token', message: 'expired' },
      });

      await expect(service.getCredenciais('emp-1')).rejects.toBeInstanceOf(IntegrationException);
    });

    it('preserva refreshToken atual quando refresh não devolve novo', async () => {
      integracoes.obterCredenciaisInternas.mockResolvedValue({
        credenciais: {
          accessToken: 'tok',
          refreshToken: 'rt-old',
          shopId: '999',
          expiresAt: now - 1000,
        },
      });
      http.post.mockResolvedValue({
        data: { access_token: 'tok-new', expire_in: 14400 }, // sem refresh_token novo
      });

      const r = await service.getCredenciais('emp-1');

      expect(r.refreshToken).toBe('rt-old');
    });
  });

  describe('resolverPorShopId', () => {
    it('retorna empresaId quando lookup por externalAccountId encontra', async () => {
      prisma.integracaoConexao.findFirst.mockResolvedValue({ empresaId: 'emp-1' });

      const r = await service.resolverPorShopId('999');

      expect(r).toBe('emp-1');
      expect(prisma.integracaoConexao.findFirst).toHaveBeenCalledWith({
        where: { servico: 'shopee', externalAccountId: '999', ativo: true },
        select: { empresaId: true },
      });
    });

    it('retorna null quando shop não encontrado', async () => {
      prisma.integracaoConexao.findFirst.mockResolvedValue(null);

      expect(await service.resolverPorShopId('888')).toBeNull();
    });
  });
});
