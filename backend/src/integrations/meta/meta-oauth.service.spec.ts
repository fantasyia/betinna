import { describe, expect, it, vi } from 'vitest';
import {
  BusinessRuleException,
  IntegrationException,
  UnauthorizedException,
} from '@shared/errors/app-exception';
import { MetaOAuthService } from './meta-oauth.service';

const ENC_KEY = 'a'.repeat(64);
const DIA_MS = 86_400_000;

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

// Após a centralização (D9), o MetaOAuthService não cifra/decifra nem faz upsert
// direto: lê via obterCredenciaisInternas e grava via salvarCredenciaisInternas.
const makeIntegracoes = () => ({
  obterCredenciaisInternas: vi.fn(),
  salvarCredenciaisInternas: vi.fn(async () => undefined),
  registrarSyncOk: vi.fn(async () => undefined),
});

// Args do salvarCredenciaisInternas: (empresaId, servico, credenciais, externalAccountId).
type SalvarArgs = [string, string, Record<string, unknown>, string];

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

    const integ = makeIntegracoes();
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      makePrisma() as never,
      integ as never,
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

    // Persistência centralizada: 2 chamadas (facebook + instagram).
    expect(integ.salvarCredenciaisInternas).toHaveBeenCalledTimes(2);
    const calls = integ.salvarCredenciaisInternas.mock.calls as unknown as SalvarArgs[];
    const fbCall = calls.find((c) => c[1] === 'facebook')!;
    expect(fbCall[0]).toBe('emp-99');
    expect(fbCall[2]).toMatchObject({ pageId: 'page-1', pageName: 'Loja X' });
    expect(fbCall[3]).toBe('page-1');
    const igCall = calls.find((c) => c[1] === 'instagram')!;
    expect(igCall[2]).toMatchObject({ igUserId: 'ig-1', igUsername: 'lojax' });
    expect(igCall[3]).toBe('ig-1');
  });

  it('persiste só Facebook quando page não tem IG vinculado', async () => {
    const graph = makeGraph();
    graph.exchangeCode.mockResolvedValueOnce({ access_token: 'short' });
    graph.exchangeLongLived.mockResolvedValueOnce({ access_token: 'long', expires_in: 5_184_000 });
    graph.listarPages.mockResolvedValueOnce([
      { id: 'page-9', name: 'Sem IG', access_token: 'page-tok-9' },
    ]);
    graph.obterIgVinculadoPage.mockResolvedValueOnce(null);

    const integ = makeIntegracoes();
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      makePrisma() as never,
      integ as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;
    const r = await svc.processCallback('code', state);
    expect(r.pagesConectadas[0].igUserId).toBeUndefined();
    expect(integ.salvarCredenciaisInternas).toHaveBeenCalledTimes(1);
    const calls = integ.salvarCredenciaisInternas.mock.calls as unknown as SalvarArgs[];
    expect(calls[0][1]).toBe('facebook');
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

  it('resolve empresaId via Prisma (lookup reverso) e decifra pelo ponto central', async () => {
    const prisma = makePrisma();
    prisma.integracaoConexao.findFirst.mockResolvedValueOnce({ empresaId: 'emp-7' });
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: { pageId: 'page-1', pageAccessToken: 'tok', igUserId: 'ig-1' },
    });

    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      prisma as never,
      integ as never,
    );
    const r = await svc.resolverPorAccount('instagram', 'ig-1');
    expect(r).toEqual({
      empresaId: 'emp-7',
      credenciais: { pageId: 'page-1', pageAccessToken: 'tok', igUserId: 'ig-1' },
    });
    // Lookup reverso por externalAccountId pede só o empresaId ao Prisma...
    expect(prisma.integracaoConexao.findFirst).toHaveBeenCalledWith({
      where: { servico: 'instagram', externalAccountId: 'ig-1', ativo: true },
      select: { empresaId: true },
    });
    // ...e a decifragem passa pelo ponto único (D9).
    expect(integ.obterCredenciaisInternas).toHaveBeenCalledWith('emp-7', 'instagram');
  });
});

describe('MetaOAuthService.renovarTokenSeNecessario', () => {
  const fbCreds = (expiresEmDias: number) => ({
    pageId: 'page-1',
    pageName: 'Loja X',
    pageAccessToken: 'page-tok-antigo',
    userAccessToken: 'user-tok-antigo',
    userTokenExpiresAt: Date.now() + expiresEmDias * DIA_MS,
  });

  it("retorna 'sem-conexao' quando não há conexão ativa", async () => {
    const integ = makeIntegracoes();
    // obterCredenciaisInternas lança quando não há conexão ativa/legível.
    integ.obterCredenciaisInternas.mockRejectedValueOnce(new Error('não configurada'));
    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      integ as never,
    );
    expect(await svc.renovarTokenSeNecessario('emp-1', 'facebook')).toBe('sem-conexao');
  });

  it("retorna 'ok' e NÃO renova quando ainda está longe de expirar", async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({ credenciais: fbCreds(40) });
    const graph = makeGraph();
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      makePrisma() as never,
      integ as never,
    );

    expect(await svc.renovarTokenSeNecessario('emp-1', 'facebook', 14)).toBe('ok');
    expect(graph.exchangeLongLived).not.toHaveBeenCalled();
    expect(integ.salvarCredenciaisInternas).not.toHaveBeenCalled();
  });

  it("retorna 'renovado' e persiste novos tokens quando perto de expirar", async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({ credenciais: fbCreds(5) });
    const graph = makeGraph();
    graph.exchangeLongLived.mockResolvedValueOnce({
      access_token: 'user-tok-novo',
      expires_in: 5_184_000,
    });
    graph.listarPages.mockResolvedValueOnce([
      { id: 'page-1', name: 'Loja X', access_token: 'page-tok-novo' },
    ]);
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      makePrisma() as never,
      integ as never,
    );

    const r = await svc.renovarTokenSeNecessario('emp-1', 'facebook', 14);

    expect(r).toBe('renovado');
    // Re-trocou o user token antigo pelo novo.
    expect(graph.exchangeLongLived).toHaveBeenCalledWith('user-tok-antigo');
    // Persistiu (centralizado) com os tokens novos + externalAccountId da page.
    const calls = integ.salvarCredenciaisInternas.mock.calls as unknown as SalvarArgs[];
    const [empresaId, servico, creds, externalAccountId] = calls[0];
    expect(empresaId).toBe('emp-1');
    expect(servico).toBe('facebook');
    expect(externalAccountId).toBe('page-1');
    expect(creds.userAccessToken).toBe('user-tok-novo');
    expect(creds.pageAccessToken).toBe('page-tok-novo');
    expect(creds.userTokenExpiresAt as number).toBeGreaterThan(Date.now());
  });

  it('lança BusinessRuleException quando a página some após renovar (revogada)', async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({ credenciais: fbCreds(2) });
    const graph = makeGraph();
    graph.exchangeLongLived.mockResolvedValueOnce({ access_token: 'user-tok-novo' });
    graph.listarPages.mockResolvedValueOnce([
      { id: 'outra-page', name: 'Outra', access_token: 'x' },
    ]);
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      makePrisma() as never,
      integ as never,
    );

    await expect(svc.renovarTokenSeNecessario('emp-1', 'facebook', 14)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it("retorna 'sem-expiracao' pra conexão legada sem userAccessToken/expiração", async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: { pageId: 'page-1', pageName: 'X', pageAccessToken: 'só-page' },
    });
    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      integ as never,
    );
    expect(await svc.renovarTokenSeNecessario('emp-1', 'facebook')).toBe('sem-expiracao');
  });
});
