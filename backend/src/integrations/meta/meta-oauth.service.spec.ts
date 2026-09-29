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

// Item 13 (29/09): o app da Meta é POR EMPRESA — o OAuth nunca usa env global.
const APP = { appId: 'app-1', appSecret: 'secret-1', verifyToken: 'verify-1' };
const makeApps = () => ({
  obter: vi.fn(async () => APP),
  talvez: vi.fn(async () => APP),
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

// #B17: consumidor de nonce (anti-replay do state OAuth). true = 1º uso.
const makeRedis = () => ({
  setNxEx: vi.fn().mockResolvedValue(true),
  eval: vi.fn().mockResolvedValue(1),
  // #40: o lock de refresh libera a chave no finally.
  del: vi.fn().mockResolvedValue(1),
});

describe('MetaOAuthService.buildAuthUrl', () => {
  it('inclui scope amplo + state JWT quando configurado', async () => {
    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
      makeApps() as never,
    );
    const url = await svc.buildAuthUrl('emp-1');
    expect(url).toContain('client_id=app-1');
    expect(url).toContain('pages_messaging');
    expect(url).toContain('instagram_manage_messages');
    expect(url).toContain('state=');
  });

  it('falha quando não configurado (sem redirect)', async () => {
    const svc = new MetaOAuthService(
      makeEnv({ META_GRAPH_REDIRECT_URI: '' }) as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
      makeApps() as never,
    );
    await expect(svc.buildAuthUrl('emp-1')).rejects.toBeInstanceOf(IntegrationException);
  });
});

describe('MetaOAuthService — app da Meta por empresa (item 13)', () => {
  it('empresa sem App da Meta cadastrado: NÃO monta o login (nunca cai no app de outra)', async () => {
    const apps = makeApps();
    apps.obter.mockRejectedValueOnce(new BusinessRuleException('Cadastre o App da Meta'));
    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
      apps as never,
    );
    await expect(svc.buildAuthUrl('emp-sem-app')).rejects.toThrow('Cadastre o App da Meta');
    expect(apps.obter).toHaveBeenCalledWith('emp-sem-app');
  });

  it('o client_id do login é o do app DA EMPRESA', async () => {
    const apps = makeApps();
    apps.obter.mockResolvedValueOnce({ ...APP, appId: 'app-da-ribelt' });
    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
      apps as never,
    );
    expect(await svc.buildAuthUrl('emp-r')).toContain('client_id=app-da-ribelt');
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
      makeRedis() as never,
      makeApps() as never,
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
      makeRedis() as never,
      makeApps() as never,
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
      makeRedis() as never,
      makeApps() as never,
    );
    const url = await svc1.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;

    const svc2 = new MetaOAuthService(
      makeEnv({ ENCRYPTION_KEY: 'b'.repeat(64) }) as never,
      makeGraph() as never,
      makePrisma() as never,
      makeIntegracoes() as never,
      makeRedis() as never,
      makeApps() as never,
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
      makeRedis() as never,
      makeApps() as never,
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
      makeRedis() as never,
      makeApps() as never,
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
      makeRedis() as never,
      makeApps() as never,
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
      makeRedis() as never,
      makeApps() as never,
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
      makeRedis() as never,
      makeApps() as never,
    );

    const r = await svc.renovarTokenSeNecessario('emp-1', 'facebook', 14);

    expect(r).toBe('renovado');
    // Re-trocou o user token antigo pelo novo.
    expect(graph.exchangeLongLived).toHaveBeenCalledWith('user-tok-antigo', APP);
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
      makeRedis() as never,
      makeApps() as never,
    );

    await expect(svc.renovarTokenSeNecessario('emp-1', 'facebook', 14)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it("sem userAccessToken → 'sem-conexao' (não há o que renovar)", async () => {
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValueOnce({
      credenciais: { pageId: 'page-1', pageName: 'X', pageAccessToken: 'só-page' },
    });
    const svc = new MetaOAuthService(
      makeEnv() as never,
      makeGraph() as never,
      makePrisma() as never,
      integ as never,
      makeRedis() as never,
      makeApps() as never,
    );
    expect(await svc.renovarTokenSeNecessario('emp-1', 'facebook')).toBe('sem-conexao');
  });

  it('#41: conexão SEM prazo salvo é renovada (antes o cron pulava e o token morria)', async () => {
    // O Graph às vezes omite `expires_in`. Nesse caso userTokenExpiresAt ficava
    // undefined, o cron devolvia 'sem-expiracao' pra sempre e por volta do 60º
    // dia a Inbox de IG/FB parava de receber — sem alerta nenhum.
    const integ = makeIntegracoes();
    integ.obterCredenciaisInternas.mockResolvedValue({
      credenciais: { pageId: 'page-1', pageName: 'X', userAccessToken: 'ut-sem-prazo' },
    });
    const graph = makeGraph();
    graph.exchangeLongLived.mockResolvedValue({ access_token: 'ut-novo' }); // sem expires_in
    graph.listarPages.mockResolvedValue([{ id: 'page-1', name: 'X', access_token: 'pt-novo' }]);
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      makePrisma() as never,
      integ as never,
      makeRedis() as never,
      makeApps() as never,
    );

    expect(await svc.renovarTokenSeNecessario('emp-1', 'facebook')).toBe('renovado');

    // E o novo prazo NÃO fica undefined — senão o problema volta no próximo ciclo.
    const calls = integ.salvarCredenciaisInternas.mock.calls as unknown as SalvarArgs[];
    const salvo = calls[0][2] as { userTokenExpiresAt?: number };
    expect(salvo.userTokenExpiresAt).toBeGreaterThan(Date.now());
  });
});

/**
 * Item 3a (29/09): conta com mais de uma Página — o admin escolhe. Antes pegava
 * a 1ª da lista (ordem da Meta) e podia ligar a empresa na Página errada.
 */
describe('MetaOAuthService — escolher a Página', () => {
  const montar = () => {
    const mem = new Map<string, string>();
    const redis = {
      ...makeRedis(),
      setEx: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
      get: vi.fn(async (k: string) => mem.get(k) ?? null),
      del: vi.fn(async (k: string) => Number(mem.delete(k))),
    };
    const graph = {
      ...makeGraph(),
      assinarAppNaPagina: vi.fn(async () => undefined),
      camposAssinadosNaPagina: vi.fn(async () => ['messages', 'leadgen']),
    };
    graph.exchangeCode.mockResolvedValue({ access_token: 'short' });
    graph.exchangeLongLived.mockResolvedValue({ access_token: 'long', expires_in: 5_184_000 });
    graph.listarPages.mockResolvedValue([
      { id: 'page-a', name: 'Loja A', access_token: 'tok-a' },
      { id: 'page-b', name: 'Loja B', access_token: 'tok-b' },
    ]);
    graph.obterIgVinculadoPage.mockResolvedValue(null);
    const integ = makeIntegracoes();
    const svc = new MetaOAuthService(
      makeEnv() as never,
      graph as never,
      makePrisma() as never,
      integ as never,
      redis as never,
      makeApps() as never,
    );
    return { svc, integ, redis, mem };
  };

  it('duas Páginas: NÃO conecta nenhuma e devolve a lista (tokens ficam cifrados no Redis)', async () => {
    const m = montar();
    const url = await m.svc.buildAuthUrl('emp-1');
    const state = new URL(url).searchParams.get('state')!;

    const r = await m.svc.processCallback('code', state);

    expect(r.pagesConectadas).toEqual([]);
    expect(r.escolherPagina).toEqual([
      { id: 'page-a', name: 'Loja A' },
      { id: 'page-b', name: 'Loja B' },
    ]);
    expect(m.integ.salvarCredenciaisInternas).not.toHaveBeenCalled();
    const guardado = [...m.mem.values()][0]!;
    expect(guardado).not.toContain('tok-a'); // cifrado
    expect(await m.svc.paginasPendentes('emp-1')).toHaveLength(2);
  });

  it('escolher conecta a Página ESCOLHIDA (não a 1ª) e apaga a pendência', async () => {
    const m = montar();
    const state = new URL(await m.svc.buildAuthUrl('emp-1')).searchParams.get('state')!;
    await m.svc.processCallback('code', state);

    const r = await m.svc.escolherPagina('emp-1', 'page-b');

    expect(r.pagesConectadas[0]).toMatchObject({ pageId: 'page-b', pageName: 'Loja B' });
    const [emp, servico, creds, ext] = m.integ.salvarCredenciaisInternas.mock
      .calls[0] as unknown as SalvarArgs;
    expect([emp, servico, ext]).toEqual(['emp-1', 'facebook', 'page-b']);
    expect(creds.pageAccessToken).toBe('tok-b');
    expect(await m.svc.paginasPendentes('emp-1')).toEqual([]);
  });

  it('Página fora da lista ou escolha expirada: erro claro', async () => {
    const m = montar();
    await expect(m.svc.escolherPagina('emp-1', 'page-a')).rejects.toThrow('expirou');
    const state = new URL(await m.svc.buildAuthUrl('emp-1')).searchParams.get('state')!;
    await m.svc.processCallback('code', state);
    await expect(m.svc.escolherPagina('emp-1', 'page-zzz')).rejects.toThrow('não está entre');
  });

  it('a pendência é por EMPRESA: outra empresa não vê nem escolhe', async () => {
    const m = montar();
    const state = new URL(await m.svc.buildAuthUrl('emp-1')).searchParams.get('state')!;
    await m.svc.processCallback('code', state);
    expect(await m.svc.paginasPendentes('emp-2')).toEqual([]);
    await expect(m.svc.escolherPagina('emp-2', 'page-a')).rejects.toThrow('expirou');
  });
});
