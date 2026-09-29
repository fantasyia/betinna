import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { conferirNavegador, vincularNavegador } from './oauth-navegador';

/**
 * O navegador que volta do provedor tem que ser o que clicou em "Conectar".
 * Sem isto, o link do "Conectar" de um usuário, mandado pra outra pessoa,
 * gravava a conta DELA (Google/ML/Meta…) no usuário ou na empresa DELE.
 * Auditoria 29/09/2026.
 */
const STATE = 'eyJhbGciOiJIUzI1NiJ9.eyJlaWQiOiJlbXAtMSJ9.assinatura';

/** Roda o `start` e devolve o valor do cookie que ele gravou. */
function cookieDoStart(url: string): string {
  const res = { cookie: vi.fn() } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };
  vincularNavegador(res, url);
  const [nome, valor, opts] = res.cookie.mock.calls[0];
  expect(nome).toBe('betinna_oauth');
  expect(opts).toMatchObject({ httpOnly: true, path: '/api/v1/integracoes' });
  return valor as string;
}

const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as unknown as Request;

describe('amarra do OAuth ao navegador', () => {
  it('mesmo navegador (cookie do start) → aceita', () => {
    const valor = cookieDoStart(`https://auth.mercadolivre.com.br/authorization?state=${STATE}`);
    expect(conferirNavegador(req(`outro=1; betinna_oauth=${valor}`), STATE)).toBeNull();
  });

  it('link repassado a outra pessoa (sem cookie) → recusa', () => {
    expect(conferirNavegador(req(), STATE)).toMatch(/outro navegador/);
  });

  it('cookie de OUTRO start (outro state) → recusa', () => {
    const valor = cookieDoStart('https://accounts.google.com/o/oauth2/v2/auth?state=outro-state');
    expect(conferirNavegador(req(`betinna_oauth=${valor}`), STATE)).toMatch(/outro navegador/);
  });

  it('Shopee: o state vem DENTRO do redirect — também amarra', () => {
    const redirect = encodeURIComponent(
      `https://api.x/api/v1/integracoes/shopee/oauth/callback?state=${STATE}`,
    );
    const valor = cookieDoStart(
      `https://partner.shopeemobile.com/api/v2/shop/auth_partner?redirect=${redirect}`,
    );
    expect(conferirNavegador(req(`betinna_oauth=${valor}`), STATE)).toBeNull();
  });

  it('URL sem state → falha no start (não emite link que não dá pra amarrar)', () => {
    const res = { cookie: vi.fn() } as unknown as Response;
    expect(() => vincularNavegador(res, 'https://x.com/auth?client_id=1')).toThrow(/sem state/);
  });
});
