import { describe, expect, it } from 'vitest';

/**
 * Convite que cai na rota errada.
 *
 * O Supabase só respeita o `redirect_to` se a URL estiver na allowlist do
 * projeto. Fora dela ele NÃO falha: cai calado na raiz do app, e quem recebeu o
 * convite vê a TELA DE LOGIN — sem ter senha ainda. Aconteceu no primeiro
 * convite real, e a allowlist vive num painel fora do repositório, então
 * qualquer domínio novo repete o problema do mesmo jeito silencioso.
 *
 * A regra abaixo espelha a de `main.tsx`. Está isolada aqui porque o main roda
 * efeitos de boot (Sentry, PWA, i18n) que não cabem num teste — o que importa
 * provar é a DECISÃO: quando redirecionar, e pra onde.
 */
function decidirRedirect(pathname: string, hash: string): string | null {
  const cru = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!cru) return null;
  const p = new URLSearchParams(cru);
  const tipo = p.get('type');
  const ehFluxoDeSenha =
    !!p.get('access_token') &&
    (tipo === 'invite' || tipo === 'recovery' || tipo === 'signup' || tipo === 'magiclink');
  return ehFluxoDeSenha && pathname !== '/welcome' ? `/welcome#${cru}` : null;
}

describe('convite que caiu na rota errada', () => {
  const HASH = '#access_token=abc&refresh_token=def&type=invite';

  it('convite na RAIZ vai pro /welcome levando o fragmento inteiro', () => {
    expect(decidirRedirect('/', HASH)).toBe(
      '/welcome#access_token=abc&refresh_token=def&type=invite',
    );
  });

  it('vale pra qualquer rota, não só a raiz', () => {
    expect(decidirRedirect('/login', HASH)).toContain('/welcome#');
    expect(decidirRedirect('/dashboard', HASH)).toContain('/welcome#');
  });

  it('já no /welcome: não redireciona (senão era laço infinito)', () => {
    expect(decidirRedirect('/welcome', HASH)).toBeNull();
  });

  it('cobre recovery, signup e magiclink — mesma tela define a senha', () => {
    for (const tipo of ['recovery', 'signup', 'magiclink']) {
      expect(decidirRedirect('/', `#access_token=abc&type=${tipo}`)).toContain('/welcome#');
    }
  });

  it('sem access_token não é fluxo de senha — não mexe', () => {
    expect(decidirRedirect('/', '#type=invite')).toBeNull();
  });

  it('hash comum de navegação não é sequestrado', () => {
    // Âncora de página (ex: o link do selo pro #ritmo-envio) tem que continuar
    // funcionando — redirecionar isso quebraria navegação normal.
    expect(decidirRedirect('/configuracoes', '#ritmo-envio')).toBeNull();
    expect(decidirRedirect('/', '')).toBeNull();
  });
});
