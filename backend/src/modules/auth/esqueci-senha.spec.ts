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
    data: { properties: { action_link: 'https://sb/verify?token=abc' } },
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
    expect(email.enviarRecuperacaoSenha).toHaveBeenCalledWith(
      expect.objectContaining({
        para: 'leandro@betinna.ai',
        resetUrl: 'https://sb/verify?token=abc',
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
