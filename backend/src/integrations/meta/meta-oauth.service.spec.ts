import { describe, expect, it, vi } from 'vitest';
import { IntegrationException, UnauthorizedException } from '@shared/errors/app-exception';
import { MetaOAuthService } from './meta-oauth.service';

const ENC_KEY = 'a'.repeat(64);

const makeEnv = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      ENCRYPTION_KEY: ENC_KEY,
      META_GRAPH_APP_ID: 'app-1',
      META_GRAPH_APP_SECRET: 'secret-1',
      META_GRAPH_REDIRECT_URI: 'http://localhost:3001/cb',
      META_GRAPH_API_VERSION: 'v21.0',
      ...overrides,
    };
    return map[k] ?? '';
  }),
});

const makeGraph = () => ({
  oauthDialogUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
  exchangeCode: vi.fn(),
  exchangeLongLived: vi.fn(),
  listarPages: vi.fn(),
  obterIgVinculadoPage: vi.fn(),
});

const makePrisma = () => ({
  integracaoConexao: {
    upsert: vi.fn(),
    findFirst: vi.fn(),
  },
});

const makeIntegracoes = () => ({
  registrarSyncOk: vi.fn(async () => undefined),
});

describe('MetaOAuthService.buildAuthUrl', () => {
  it('inclui scope amplo + state JWT quando configurado', async () => {
    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    expect(url).toContain('client_id=app-1');
    expect(url).toContain('pages_messaging');
    expect(url).toContain('instagram_manage_messages');
    expect(url).toContain('state=');
  });

  it('falha quando não configurado', async () => {
    const svc = new MetaOAuthService(
      makeEnv({ META_GRAPH_APP_ID: '' }) as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    await expect(svc.buildAuthUrl('emp-1')).rejects.toBeInstanceOf(IntegrationException);
  });
});

describe('MetaOAuthService.processCallback', () => {
  it('roundtrip: persiste Facebook + Instagram quando IG está vinculado', async () => {
    const graph = makeGraph();
    graph.exchangeCode.mockResolvedValueOnce({ access_token: 'short', token_type: 'bearer' });
    graph.exchangeLongLived.mockResolvedValueOnce({
      access_token: 'long-user',
      token_type: 'bearer',
      expires_in: 5_184_000,
    });
    graph.listarPages.mockResolvedValueOnce([
      { id: 'page-1', name: 'Loja X', access_token: 'page-tok-1' },
    ]);
    graph.obterIgVinculadoPage.mockResolvedValueOnce({ id: 'ig-1', username: 'lojax' });

    const prisma = makePrisma();
    prisma.integracaoConexao.upsert.mockResolvedValue({});

    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      prisma as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-99');
    const state = new URL(url).searchParams.get('state')!;

    const r = await svc.processCallback('code-x', state);
    expect(r.pagesConectadas).toHaveLength(1);
    expect(r.pagesConectadas[0]).toMatchObject({
      pageId: 'page-1',
      pageName: 'Loja X',
      igUserId: 'ig-1',
      igUsername: 'lojax',
    });
    expect(prisma.integracaoConexao.upsert).toHaveBeenCalledTimes(2);
    // Facebook conexão
    const fbCall = prisma.integracaoConexao.upsert.mock.calls.find(
      (c: unknown[]) => (c[0] as { create: { servico: string } }).create.servico === 'facebook',
    )!;
    expect((fbCall[0] as { create: { externalAccountId: string } }).create.externalAccountId).toBe(
      'page-1',
    );
    // Instagram conexão
    const igCall = prisma.integracaoConexao.upsert.mock.calls.find(
      (c: unknown[]) => (c[0] as { create: { servico: string } }).create.servico === 'instagram',
    )!;
    expect((igCall[0] as { create: { externalAccountId: string } }).create.externalAccountId).toBe(
      'ig-1',
    );
  });

  it('persiste só Facebook quando page não tem IG vinculado', async () => {
    const graph = makeGraph();
    graph.exchangeCode.mockResolvedValueOnce({ access_token: 'short' });
    graph.exchangeLongLived.mockResolvedValueOnce({ access_token: 'long', expires_in: 5_184_000 });
    graph.listarPages.mockResolvedValueOnce([
      { id: 'page-9', name: 'Sem IG', access_token: 'page-tok-9' },
    ]);
    graph.obterIgVinculadoPage.mockResolvedValueOnce(null);

    const prisma = makePrisma();
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      prisma as never,
      makeIntegracoes() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;
    const r = await svc.processCallback('code', state);
    expect(r.pagesConectadas[0].igUserId).toBeUndefined();
    expect(prisma.integracaoConexao.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejeita state assinado com outra ENCRYPTION_KEY', async () => {
    const svc1 = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    const url = await svc1.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;

    const svc2 = new MetaOAuthService(
      makeEnv({ ENCRYPTION_KEY: 'b'.repeat(64) }) as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
    );
    await expect(svc2.processCallback('c', state)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('MetaOAuthService.resolverPorAccount', () => {
  it('retorna null quando não há IntegracaoConexao com aquele accountId', async () => {
    const prisma = makePrisma();
    prisma.integracaoConexao.findFirst.mockResolvedValueOnce(null);

    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      prisma as never,
      makeIntegracoes() as never,
    );
    const r = await svc.resolverPorAccount('facebook', 'page-xyz');
    expect(r).toBeNull();
  });
});
