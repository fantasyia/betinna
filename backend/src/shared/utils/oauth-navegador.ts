import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Amarra o fluxo OAuth ao NAVEGADOR que clicou em "Conectar".
 *
 * O `state` JWT (oauth-state.util.ts) prova que o Betinna gerou o link, e o
 * `jti` impede reuso — mas não prova QUEM volta. Sem esta amarra, um usuário
 * pegava o link do próprio "Conectar", mandava pra outra pessoa ("conecta sua
 * agenda aqui"), e a conta Google/ML/Meta DELA ficava gravada no usuário ou na
 * empresa DELE. Com a Ribelt como segunda empresa no app, virou cross-tenant.
 * Auditoria 29/09/2026 (era o item adiado de 30/06).
 *
 * Como: no `start`, grava um cookie httpOnly com o SHA-256 do `state` que foi
 * pro link. No `callback`, exige que o cookie bata com o `state` que voltou.
 * Quem recebe o link por fora não tem o cookie. Os services de cada integração
 * não mudam — a amarra fica nos controllers.
 */
const COOKIE = 'betinna_oauth';
/** Folga sobre o TTL de 5 min do state (tempo de login/consentimento no provedor). */
const MAX_AGE_MS = 15 * 60 * 1000;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Extrai o `state` da URL de autorização gerada pelo service. */
function stateDaUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const direto = u.searchParams.get('state');
    if (direto) return direto;
    // Shopee: o state vai DENTRO do redirect_uri (o provedor preserva e devolve).
    const redirect = u.searchParams.get('redirect') ?? u.searchParams.get('redirect_uri');
    if (redirect) return new URL(redirect).searchParams.get('state');
  } catch {
    /* URL inválida → sem state */
  }
  return null;
}

/** Chamado no `start`: grava o cookie amarrado ao `state` desta URL. */
export function vincularNavegador(res: Response, url: string): void {
  const producao = process.env.NODE_ENV === 'production';
  const state = stateDaUrl(url);
  if (!state) {
    throw new Error('URL de autorização sem state — não dá pra amarrar ao navegador');
  }
  res.cookie(COOKIE, hash(state), {
    httpOnly: true,
    secure: producao,
    // O app (app.) chama a API (api.) por fetch; a volta do provedor é navegação
    // de topo no popup. None+Secure em prod cobre os dois, igual ao refresh.
    sameSite: producao ? 'none' : 'lax',
    maxAge: MAX_AGE_MS,
    path: '/api/v1/integracoes',
  });
}

/**
 * Chamado no `callback`, ANTES de trocar o código: o navegador que voltou tem
 * que ser o que clicou. Devolve a mensagem de erro, ou null se bateu.
 */
export function conferirNavegador(req: Request, state: string): string | null {
  const cookies = (req.headers.cookie ?? '').split(';').map((c) => c.trim());
  const bruto = cookies.find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
  const esperado = hash(state);
  const a = Buffer.from(decodeURIComponent(bruto));
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return (
      'Esta conexão foi iniciada em outro navegador. Por segurança, abra o Betinna ' +
      'e clique em "Conectar" neste mesmo navegador.'
    );
  }
  return null;
}
