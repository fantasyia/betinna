import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from './auth-session.service';

/**
 * "Esqueceu sua senha?" — o endpoint público que MANDA E-MAIL.
 *
 * Três propriedades importam mais que o envio em si: ele não pode contar quem
 * tem conta aqui, não pode virar máquina de bombardear a caixa de alguém, e
 * pedir de novo tem que mandar DE NOVO — o mesmo link, enquanto ele vale.
 */
const build = (
  over: {
    usuario?: Record<string, unknown> | null;
    janelaLivre?: boolean;
    doDia?: number;
    tokenEmCache?: string;
  } = {},
) => {
  const prisma = {
    usuario: {
      findFirst: vi.fn(async () =>
        over.usuario === undefined ? { nome: 'Leandro', status: 'ATIVO' } : over.usuario,
      ),
    },
  };
  const redis = {
    setNxEx: vi.fn(async () => over.janelaLivre ?? true),
    incr: vi.fn(async () => over.doDia ?? 1),
    setEx: vi.fn(async () => undefined),
    get: vi.fn(async () => over.tokenEmCache ?? null),
    del: vi.fn(async () => 1),
  };
  const email = { enviarRecuperacaoSenha: vi.fn(async () => ({ ok: true })) };
  const env = { get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app.betinna.ai' : 'x') };
  const svc = Object.create(AuthSessionService.prototype) as AuthSessionService;
  const generateLink = vi.fn(async () => ({
    data: {
      properties: { action_link: 'https://sb/verify?token=abc', hashed_token: 'pkce_hash_abc123' },
    },
    error: null,
  }));
  Object.assign(svc, {
    prisma,
    redis,
    email,
    env,
    supabaseAdmin: { auth: { admin: { generateLink } } },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return { svc, prisma, redis, email, generateLink };
};

describe('AuthSessionService.esqueciSenha', () => {
  beforeEach(() => vi.clearAllMocks());

  it('e-mail existente: gera o link de recovery e manda pelo Resend', async () => {
    const { svc, email, generateLink } = build();

    const r = await svc.esqueciSenha('Leandro@Betinna.AI');

    expect(r).toEqual({ enviado: true, restantes: 4 });
    // normaliza pra minúsculas — senão o mesmo endereço fura o contador
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'recovery', email: 'leandro@betinna.ai' }),
    );
    // O e-mail leva o token pro NOSSO /welcome, não o action_link do Supabase —
    // o action_link é um GET de uso único, e morria no segundo navegador.
    expect(email.enviarRecuperacaoSenha).toHaveBeenCalledWith(
      expect.objectContaining({
        para: 'leandro@betinna.ai',
        resetUrl: 'https://app.betinna.ai/welcome?token_hash=pkce_hash_abc123&type=recovery',
      }),
    );
  });

  it('token novo vai pro cache por 55min — abaixo da 1h do Supabase', async () => {
    const { svc, redis } = build();

    await svc.esqueciSenha('leandro@betinna.ai');

    expect(redis.setEx).toHaveBeenCalledWith(
      'auth:reset:token:leandro@betinna.ai',
      'pkce_hash_abc123',
      55 * 60,
    );
    // e o mapa reverso, pra derrubar o cache na hora de usar o token
    expect(redis.setEx).toHaveBeenCalledWith(
      'auth:reset:hash:pkce_hash_abc123',
      'leandro@betinna.ai',
      55 * 60,
    );
  });

  it('pedir de novo dentro da hora REENVIA O MESMO link — não gera token novo', async () => {
    // O Supabase guarda um token de recovery por usuário: gerar outro invalida
    // o e-mail anterior. Quem abria qualquer e-mail que não fosse o último
    // tomava 403 — medido em 06/09.
    const { svc, email, generateLink } = build({ tokenEmCache: 'pkce_ja_existente' });

    await svc.esqueciSenha('leandro@betinna.ai');

    expect(generateLink).not.toHaveBeenCalled();
    expect(email.enviarRecuperacaoSenha).toHaveBeenCalledWith(
      expect.objectContaining({
        resetUrl: 'https://app.betinna.ai/welcome?token_hash=pkce_ja_existente&type=recovery',
      }),
    );
  });

  it('e-mail que não existe: mesma resposta, e NÃO manda nada', async () => {
    // Diferenciar aqui transformaria o endpoint em consulta de "quem tem conta".
    const { svc, email } = build({ usuario: null });

    const r = await svc.esqueciSenha('naoexiste@x.com');

    expect(r).toEqual({ enviado: true });
    expect(email.enviarRecuperacaoSenha).not.toHaveBeenCalled();
  });

  it('usuário INATIVO não redefine senha — seria porta de volta pra quem saiu', async () => {
    const { svc, email } = build({ usuario: { nome: 'Ex', status: 'INATIVO' } });

    await svc.esqueciSenha('ex@x.com');

    expect(email.enviarRecuperacaoSenha).not.toHaveBeenCalled();
  });

  it('clique duplo (<10s) é absorvido sem gastar um dos cinco', async () => {
    const { svc, email, prisma } = build({ janelaLivre: false });

    const r = await svc.esqueciSenha('leandro@betinna.ai');

    expect(r).toEqual({ enviado: true });
    expect(email.enviarRecuperacaoSenha).not.toHaveBeenCalled();
    // nem chega a consultar o banco — o corte é antes
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
  });

  it('pedir de novo MANDA de novo — e diz quantos ainda restam', async () => {
    // Regra do Léo (06/09): quem clica de novo é porque não chegou. Responder
    // "enviado" sem mandar é o que faz a pessoa clicar uma terceira vez.
    const { svc, email } = build({ doDia: 3 });

    const r = await svc.esqueciSenha('leandro@betinna.ai');

    expect(email.enviarRecuperacaoSenha).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ enviado: true, restantes: 2 });
  });

  it('acima de 5 em 24h, para — e DIZ que parou (teto por ENDEREÇO, não por IP)', async () => {
    // O @Throttle do controller conta por IP; trocar de IP é trivial e sozinho
    // ele não protege a caixa de ninguém. E o limite é dito com todas as letras:
    // não vaza se a conta existe, porque o contador é por endereço digitado.
    const { svc, email } = build({ doDia: 6 });

    const r = await svc.esqueciSenha('alvo@x.com');

    expect(r).toEqual({ enviado: false, motivo: 'limite_diario', restantes: 0 });
    expect(email.enviarRecuperacaoSenha).not.toHaveBeenCalled();
  });

  it('falha do Supabase não vaza — resposta continua neutra', async () => {
    const { svc, email } = build();
    Object.assign(svc, {
      supabaseAdmin: {
        auth: {
          admin: { generateLink: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) },
        },
      },
    });

    const r = await svc.esqueciSenha('leandro@betinna.ai');

    expect(r).toEqual({ enviado: true });
    expect(email.enviarRecuperacaoSenha).not.toHaveBeenCalled();
  });
});

describe('AuthSessionService.redefinirSenha', () => {
  const buildReset = (verify: { ok: boolean; status: number; body: unknown }) => {
    const svc = Object.create(AuthSessionService.prototype) as AuthSessionService;
    const welcomeFinalize = vi.fn(async () => ({
      accessToken: 'app-token',
      expiresAt: 1,
      userId: 'u1',
    }));
    const redis = { del: vi.fn(async () => 1), get: vi.fn(async () => 'leandro@betinna.ai') };
    // `supabaseUrl`/`supabaseAnonKey` são getters que leem o env — mocka a fonte.
    Object.assign(svc, {
      env: {
        get: (k: string) =>
          k === 'SUPABASE_URL' ? 'https://sb.local' : k === 'SUPABASE_ANON_KEY' ? 'anon' : 'x',
      },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      welcomeFinalize,
      redis,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: verify.ok, status: verify.status, json: async () => verify.body })),
    );
    return { svc, welcomeFinalize, redis };
  };

  it('troca o token_hash por sessão SÓ no envio da senha, e segue pelo caminho do convite', async () => {
    const { svc, welcomeFinalize, redis } = buildReset({
      ok: true,
      status: 200,
      body: { access_token: 'sb-access', user: { email: 'Leandro@Betinna.ai' } },
    });

    const r = await svc.redefinirSenha('pkce_hash_abc123_long_enough', 'senha-nova-8', {} as never);

    expect(fetch).toHaveBeenCalledWith(
      'https://sb.local/auth/v1/verify',
      expect.objectContaining({ method: 'POST' }),
    );
    // modo 'reset': a conta é ATIVA por definição — o gate de "só PENDENTE" do
    // convite é o que devolvia 403 e consumia o token (06/09, 23:54:40)
    expect(welcomeFinalize).toHaveBeenCalledWith('sb-access', 'senha-nova-8', {}, 'reset');
    expect(r.accessToken).toBe('app-token');
    // senha gravada = token morto no Supabase = some do cache, senão o próximo
    // "esqueci" reenviaria um link já gasto
    expect(redis.del).toHaveBeenCalledWith(
      'auth:reset:hash:pkce_hash_abc123_long_enough',
      'auth:reset:token:leandro@betinna.ai',
    );
  });

  it('token já usado/expirado/substituído: erro legível em português, sem gravar senha', async () => {
    const { svc, welcomeFinalize } = buildReset({
      ok: false,
      status: 403,
      body: { msg: 'One-time token not found' },
    });

    await expect(
      svc.redefinirSenha('pkce_hash_abc123_long_enough', 'senha-nova-8', {} as never),
    ).rejects.toThrow(/já foi usado, expirou ou foi substituído/);
    expect(welcomeFinalize).not.toHaveBeenCalled();
  });

  it('verify que FALHA também derruba o cache — o hash acha o e-mail pelo mapa reverso', async () => {
    // Caso real de 06/09: verify passou, welcomeFinalize deu 403, e o token
    // gasto ficou 55min no cache sendo reenviado morto a cada "esqueci".
    const { svc, redis } = buildReset({
      ok: false,
      status: 403,
      body: { msg: 'One-time token not found' },
    });

    await svc
      .redefinirSenha('pkce_hash_abc123_long_enough', 'senha-nova-8', {} as never)
      .catch(() => undefined);

    expect(redis.get).toHaveBeenCalledWith('auth:reset:hash:pkce_hash_abc123_long_enough');
    expect(redis.del).toHaveBeenCalledWith(
      'auth:reset:hash:pkce_hash_abc123_long_enough',
      'auth:reset:token:leandro@betinna.ai',
    );
  });

  it('senha curta é barrada ANTES de gastar o token', async () => {
    const { svc } = buildReset({ ok: true, status: 200, body: { access_token: 'x' } });

    await expect(
      svc.redefinirSenha('pkce_hash_abc123_long_enough', '1234', {} as never),
    ).rejects.toThrow(/8 caracteres/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AuthSessionService.welcomeFinalize — gate por modo', () => {
  const buildFinalize = (status: 'ATIVO' | 'PENDENTE' | 'INATIVO') => {
    const svc = Object.create(AuthSessionService.prototype) as AuthSessionService;
    const updateUserById = vi.fn(async () => ({ error: null }));
    const login = vi.fn(async () => ({ accessToken: 'app', expiresAt: 1, userId: 'u1' }));
    Object.assign(svc, {
      env: {
        get: (k: string) =>
          k === 'SUPABASE_URL' ? 'https://sb.local' : k === 'SUPABASE_ANON_KEY' ? 'anon' : 'x',
      },
      prisma: {
        usuario: {
          findUnique: vi.fn(async () => ({ status })),
          update: vi.fn(async () => ({})),
        },
      },
      supabaseAdmin: { auth: { admin: { updateUserById } } },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      login,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ id: 'u1', email: 'x@y.com' }) })),
    );
    return { svc, updateUserById, login };
  };
  const TOKEN = 'access-token-long-enough-xxxxxxxx';

  it("reset em conta ATIVA passa — é o caso normal de 'esqueci minha senha'", async () => {
    const { svc, updateUserById, login } = buildFinalize('ATIVO');

    await svc.welcomeFinalize(TOKEN, 'senha-nova-8', {} as never, 'reset');

    expect(updateUserById).toHaveBeenCalledWith('u1', {
      password: 'senha-nova-8',
      email_confirm: true,
    });
    expect(login).toHaveBeenCalled();
  });

  it('reset em conta INATIVA é barrado — seria porta de volta pra quem saiu', async () => {
    const { svc, updateUserById } = buildFinalize('INATIVO');

    await expect(svc.welcomeFinalize(TOKEN, 'senha-nova-8', {} as never, 'reset')).rejects.toThrow(
      /não está ativa/,
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('convite em conta ATIVA continua barrado (anti-sequestro por token velho)', async () => {
    const { svc, updateUserById } = buildFinalize('ATIVO');

    await expect(svc.welcomeFinalize(TOKEN, 'senha-nova-8', {} as never)).rejects.toThrow(
      /já está ativa/,
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
