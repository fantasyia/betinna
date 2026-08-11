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
  salvarCredenciaisInternas: vi.fn(async () => undefined),
  // #40: double-check dentro do lock + invalidação em invalid_grant.
  descartarCacheDeCredenciais: vi.fn(),
  marcarDesconectado: vi.fn(async () => undefined),
});

// #B17: consumidor de nonce (anti-replay do state OAuth). true = 1º uso.
const makeRedis = () => ({
  setNxEx: vi.fn().mockResolvedValue(true),
  eval: vi.fn().mockResolvedValue(1),
  // #40: o lock de refresh libera a chave no finally.
  del: vi.fn().mockResolvedValue(1),
});

describe('MLOAuthService.buildAuthUrl', () => {
  it('inclui state JWT + client_id quando configurado', async () => {
    const svc = new MLOAuthService(
      makeEnv() as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
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
      makeRedis() as never,
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
    const integ = makeIntegracoes();
    const svc = new MLOAuthService(
      makeEnv() as never,
      http as never,
      prisma as never,
      integ as never,
      makeRedis() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;
    const r = await svc.processCallback('code-abc', state);
    expect(r.empresaId).toBe('emp-1');
    expect(r.userId).toBe('9876543');
    // Persistência agora é centralizada em IntegracoesService.salvarCredenciaisInternas.
    expect(integ.salvarCredenciaisInternas).toHaveBeenCalledWith(
      'emp-1',
      'mercadolivre',
      expect.objectContaining({ userId: '9876543' }),
      '9876543',
    );
  });

  it('rejeita state assinado com outra ENCRYPTION_KEY', async () => {
    const svc1 = new MLOAuthService(
      makeEnv() as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
    );
    const url = await svc1.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;

    const svc2 = new MLOAuthService(
      makeEnv({ ENCRYPTION_KEY: 'b'.repeat(64) }) as never,
      makeHttp() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
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
      makeRedis() as never,
    );
    const r = await svc.getAccessToken('emp-1');
    expect(r.accessToken).toBe('still-valid');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('faz refresh quando token está próximo de expirar', async () => {
    const integ = makeIntegracoes();
    // #40: agora são DUAS leituras — a de fora e a re-leitura dentro do lock.
    integ.obterCredenciaisInternas.mockResolvedValue({
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
      makeRedis() as never,
    );
    const r = await svc.getAccessToken('emp-1');
    expect(r.accessToken).toBe('fresh');
    expect(r.refreshToken).toBe('rt-new');
    expect(http.post).toHaveBeenCalledTimes(1);
    // Confirma persist com novo refresh token + externalAccountId (centralizado).
    expect(integ.salvarCredenciaisInternas).toHaveBeenCalled();
  });

  it('#40: se OUTRO processo já renovou, NÃO refresca com o refresh rotacionado', async () => {
    // Este é o caso que quebrava a integração: o `c` lido antes do lock (ou do
    // cache de 5min) traz um refresh_token que o ML já rotacionou. Usar ele
    // devolve invalid_grant e derruba tudo até alguém reconectar na mão.
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas
      .mockResolvedValueOnce({
        credenciais: {
          userId: '9876543',
          accessToken: 'expired',
          refreshToken: 'rt-old',
          expiresAt: Date.now() - 1000,
        },
      })
      // Re-leitura DENTRO do lock: o vencedor já publicou credencial válida.
      .mockResolvedValue({
        credenciais: {
          userId: '9876543',
          accessToken: 'do-vencedor',
          refreshToken: 'rt-new',
          expiresAt: Date.now() + 3_600_000,
        },
      });
    const http = makeHttp();
    const svc = new MLOAuthService(
      makeEnv() as never,
      http as never,
      makePrisma() as never,
      integ as never,
      makeRedis() as never,
    );

    const r = await svc.getAccessToken('emp-1');

    expect(r.accessToken).toBe('do-vencedor');
    expect(http.post).not.toHaveBeenCalled(); // não gastou o refresh velho
    expect(integ.descartarCacheDeCredenciais).toHaveBeenCalledWith('emp-1', 'mercadolivre');
  });

  it('#40: invalid_grant descarta o cache e marca a integração desconectada', async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValue({
      credenciais: {
        userId: '9876543',
        accessToken: 'expired',
        refreshToken: 'rt-morto',
        expiresAt: Date.now() - 1000,
      },
    });
    const http = makeHttp();
    http.post.mockRejectedValue(new Error('ML /oauth/token HTTP 400: invalid_grant'));
    const svc = new MLOAuthService(
      makeEnv() as never,
      http as never,
      makePrisma() as never,
      integ as never,
      makeRedis() as never,
    );

    await expect(svc.getAccessToken('emp-1')).rejects.toThrow(/invalid_grant/i);
    expect(integ.marcarDesconectado).toHaveBeenCalledWith(
      'emp-1',
      'mercadolivre',
      expect.stringMatching(/reconecte/i),
    );
  });
});
