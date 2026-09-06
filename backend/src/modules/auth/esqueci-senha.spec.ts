import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from './auth-session.service';

/**
 * "Esqueceu sua senha?" — o endpoint público que MANDA E-MAIL.
 *
 * Duas propriedades importam mais que o envio em si: ele não pode contar quem
 * tem conta aqui, e não pode virar máquina de bombardear a caixa de alguém.
 */
const build = (
  over: { usuario?: Record<string, unknown> | null; janelaLivre?: boolean; doDia?: number } = {},
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

    expect(r).toEqual({ enviado: true });
    // normaliza pra minúsculas — senão o mesmo endereço fura o cooldown
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

  it('segundo pedido dentro de 5min não manda de novo', async () => {
    const { svc, email, prisma } = build({ janelaLivre: false });

    const r = await svc.esqueciSenha('leandro@betinna.ai');

    expect(r).toEqual({ enviado: true });
    expect(email.enviarRecuperacaoSenha).not.toHaveBeenCalled();
    // nem chega a consultar o banco — o corte é antes
    expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
  });

  it('acima de 5 pedidos em 24h, para de mandar (teto por ENDEREÇO, não por IP)', async () => {
    // O @Throttle do controller conta por IP; trocar de IP é trivial e sozinho
    // ele não protege a caixa de ninguém.
    const { svc, email } = build({ doDia: 6 });

    const r = await svc.esqueciSenha('alvo@x.com');

    expect(r).toEqual({ enviado: true });
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
    // `supabaseUrl`/`supabaseAnonKey` são getters que leem o env — mocka a fonte.
    Object.assign(svc, {
      env: {
        get: (k: string) =>
          k === 'SUPABASE_URL' ? 'https://sb.local' : k === 'SUPABASE_ANON_KEY' ? 'anon' : 'x',
      },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      welcomeFinalize,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: verify.ok, status: verify.status, json: async () => verify.body })),
    );
    return { svc, welcomeFinalize };
  };

  it('troca o token_hash por sessão SÓ no envio da senha, e segue pelo caminho do convite', async () => {
    const { svc, welcomeFinalize } = buildReset({
      ok: true,
      status: 200,
      body: { access_token: 'sb-access' },
    });

    const r = await svc.redefinirSenha('pkce_hash_abc123_long_enough', 'senha-nova-8', {} as never);

    expect(fetch).toHaveBeenCalledWith(
      'https://sb.local/auth/v1/verify',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(welcomeFinalize).toHaveBeenCalledWith('sb-access', 'senha-nova-8', {});
    expect(r.accessToken).toBe('app-token');
  });

  it('token já usado/expirado: erro legível em português, sem gravar senha', async () => {
    const { svc, welcomeFinalize } = buildReset({
      ok: false,
      status: 403,
      body: { msg: 'One-time token not found' },
    });

    await expect(
      svc.redefinirSenha('pkce_hash_abc123_long_enough', 'senha-nova-8', {} as never),
    ).rejects.toThrow(/já foi usado ou expirou/);
    expect(welcomeFinalize).not.toHaveBeenCalled();
  });

  it('senha curta é barrada ANTES de gastar o token', async () => {
    const { svc } = buildReset({ ok: true, status: 200, body: { access_token: 'x' } });

    await expect(
      svc.redefinirSenha('pkce_hash_abc123_long_enough', '1234', {} as never),
    ).rejects.toThrow(/8 caracteres/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
