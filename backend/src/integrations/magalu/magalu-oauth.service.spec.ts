import { describe, expect, it, vi } from 'vitest';
import { IntegracaoNaoConfiguradaException } from '@shared/errors/app-exception';
import { HttpClientError } from '@shared/http/http-client.types';
import { MAGALU_SCOPES_PADRAO, MagaluOAuthService } from './magalu-oauth.service';

const ENC_KEY = 'b'.repeat(64);

const makeEnv = (overrides: Record<string, string> = {}) => ({
  get: vi.fn((k: string): string => {
    const map: Record<string, string> = {
      ENCRYPTION_KEY: ENC_KEY,
      MAGALU_CLIENT_ID: 'cid-mgl',
      MAGALU_CLIENT_SECRET: 'csec-mgl',
      MAGALU_REDIRECT_URI: 'https://api.ribelt.com.br/api/v1/integracoes/magalu/oauth/callback',
      MAGALU_SCOPES: '',
      ...overrides,
    };
    return map[k] ?? '';
  }),
});

function montar(opts: { env?: Record<string, string>; creds?: Record<string, unknown> } = {}) {
  const http = { post: vi.fn(), get: vi.fn() };
  let salvo: Record<string, unknown> | undefined = opts.creds;
  const integracoes = {
    obterCredenciaisInternas: vi.fn(async () => ({ credenciais: salvo ?? {} })),
    salvarCredenciaisInternas: vi.fn(
      async (
        _e: string,
        _s: string,
        c: Record<string, unknown>,
        _externo?: string,
        _op?: { carimbarConexao?: boolean },
      ) => {
        salvo = c;
      },
    ),
    descartarCacheDeCredenciais: vi.fn(),
    marcarDesconectado: vi.fn(async () => undefined),
  };
  const redis = {
    setNxEx: vi.fn().mockResolvedValue(true),
    eval: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  };
  const svc = new MagaluOAuthService(
    makeEnv(opts.env) as never,
    http as never,
    integracoes as never,
    redis as never,
  );
  return { svc, http, integracoes, redis };
}

describe('MagaluOAuthService.buildAuthUrl', () => {
  it('monta o login do ID Magalu com client_id, redirect, escopos, choose_tenants e state', async () => {
    const { svc } = montar();
    const url = new URL(await svc.buildAuthUrl('emp-1'));
    expect(`${url.origin}${url.pathname}`).toBe('https://id.magalu.com/login');
    expect(url.searchParams.get('client_id')).toBe('cid-mgl');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.ribelt.com.br/api/v1/integracoes/magalu/oauth/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('choose_tenants')).toBe('true');
    expect(url.searchParams.get('scope')).toBe(MAGALU_SCOPES_PADRAO.join(' '));
    expect(url.searchParams.get('state')).toBeTruthy();
    // O segredo NUNCA vai na URL do navegador.
    expect(url.toString()).not.toContain('csec-mgl');
  });

  it('nenhum escopo padrão escreve estoque', () => {
    expect(MAGALU_SCOPES_PADRAO.some((s) => /stock/.test(s) && /write/.test(s))).toBe(false);
  });

  it('MAGALU_SCOPES troca os escopos (normaliza espaços)', async () => {
    const { svc } = montar({
      env: { MAGALU_SCOPES: '  open:portfolio-skus-seller:read   open:order-order-seller:read ' },
    });
    const url = new URL(await svc.buildAuthUrl('emp-1'));
    expect(url.searchParams.get('scope')).toBe(
      'open:portfolio-skus-seller:read open:order-order-seller:read',
    );
  });

  it('sem client_id/secret/redirect → não configurado', async () => {
    const { svc } = montar({ env: { MAGALU_CLIENT_SECRET: '' } });
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.buildAuthUrl('emp-1')).rejects.toBeInstanceOf(
      IntegracaoNaoConfiguradaException,
    );
  });
});

describe('MagaluOAuthService.processCallback', () => {
  it('troca o code em JSON, busca a loja e persiste carimbando a conexão', async () => {
    const { svc, http, integracoes } = montar();
    const state = new URL(await svc.buildAuthUrl('emp-1')).searchParams.get('state') as string;
    http.post.mockResolvedValue({
      data: { access_token: 'at1', refresh_token: 'rt1', expires_in: 7200, scope: 'x y' },
    });
    http.get.mockResolvedValue({
      data: { tenant: { id: 'ten-1' }, seller: { id: 'sel-1', name: 'Lghb Textil' } },
    });
    const r = await svc.processCallback('code-1', state);
    expect(r).toEqual({ empresaId: 'emp-1', loja: 'Lghb Textil' });
    const [url, opts] = http.post.mock.calls[0];
    expect(url).toBe('https://id.magalu.com/oauth/token');
    expect(opts.body).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid-mgl',
      client_secret: 'csec-mgl',
      redirect_uri: 'https://api.ribelt.com.br/api/v1/integracoes/magalu/oauth/callback',
      code: 'code-1',
    });
    expect(opts.redactKeys).toEqual(expect.arrayContaining(['client_secret', 'refresh_token']));
    const [emp, servico, creds, externo, op] = integracoes.salvarCredenciaisInternas.mock.calls[0];
    expect([emp, servico, externo, op]).toEqual([
      'emp-1',
      'magalu',
      'ten-1',
      { carimbarConexao: true },
    ]);
    expect(creds).toMatchObject({ accessToken: 'at1', refreshToken: 'rt1', sellerId: 'sel-1' });
  });

  it('state reaproveitado (replay) é recusado', async () => {
    const { svc, http, redis } = montar();
    const state = new URL(await svc.buildAuthUrl('emp-1')).searchParams.get('state') as string;
    redis.setNxEx.mockResolvedValue(false);
    await expect(svc.processCallback('code-1', state)).rejects.toThrow();
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe('MagaluOAuthService.getCredenciais (refresh)', () => {
  it('token válido não chama o /oauth/token', async () => {
    const { svc, http } = montar({
      creds: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 },
    });
    const c = await svc.getCredenciais('emp-1');
    expect(c.accessToken).toBe('at');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('vencido: renova em FORM com refresh_token e persiste sem carimbar', async () => {
    const { svc, http, integracoes } = montar({
      creds: {
        accessToken: 'velho',
        refreshToken: 'rt-velho',
        expiresAt: Date.now() - 1000,
        sellerId: 's1',
      },
    });
    http.post.mockResolvedValue({
      data: { access_token: 'novo', refresh_token: 'rt-novo', expires_in: 7200 },
    });
    const c = await svc.getCredenciais('emp-1');
    expect(c).toMatchObject({ accessToken: 'novo', refreshToken: 'rt-novo', sellerId: 's1' });
    const body = http.post.mock.calls[0][1].body as URLSearchParams;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'cid-mgl',
      client_secret: 'csec-mgl',
      refresh_token: 'rt-velho',
    });
    expect(integracoes.salvarCredenciaisInternas.mock.calls[0][4]).toEqual({
      carimbarConexao: false,
    });
  });

  it('sem refresh novo na resposta, mantém o antigo', async () => {
    const { svc, http } = montar({
      creds: { accessToken: 'v', refreshToken: 'rt-fica', expiresAt: Date.now() - 1000 },
    });
    http.post.mockResolvedValue({ data: { access_token: 'n', expires_in: 7200 } });
    expect((await svc.getCredenciais('emp-1')).refreshToken).toBe('rt-fica');
  });

  it('refresh recusado (400 invalid_grant) marca desconectado', async () => {
    const { svc, http, integracoes } = montar({
      creds: { accessToken: 'v', refreshToken: 'morto', expiresAt: Date.now() - 1000 },
    });
    http.post.mockRejectedValue(
      new HttpClientError(
        400,
        { error: 'invalid_grant' },
        'https://id.magalu.com/oauth/token',
        'POST',
        1,
      ),
    );
    await expect(svc.getCredenciais('emp-1')).rejects.toThrow(/invalid_grant/);
    expect(integracoes.marcarDesconectado).toHaveBeenCalledWith(
      'emp-1',
      'magalu',
      expect.stringMatching(/reconecte/),
    );
  });

  it('credencial incompleta pede reconexão', async () => {
    const { svc } = montar({ creds: { accessToken: 'x' } });
    await expect(svc.getCredenciais('emp-1')).rejects.toThrow(/reconecte/);
  });
});
