/**
 * Validade da credencial de uma integração — "quando este token vence?".
 *
 * Nasceu do Melhor Envio (20/10): o token pessoal vale 1 ano e ninguém é
 * avisado; no dia, o frete da vitrine para de cotar. A data mora DENTRO do
 * token (JWT `exp`) ou num campo que a nossa conexão OAuth grava.
 *
 * Dois grupos, e a diferença é quem age:
 *  - RENOVA SOZINHO: OAuth com refresh (marketplaces, Tiny) ou o job de
 *    renovação da Meta. A data é informativa; ninguém precisa fazer nada.
 *  - MANUAL: alguém gera token novo no painel do serviço e cola no app. É
 *    pra estes que sai o e-mail de aviso.
 */

/** Serviços cuja credencial o próprio app renova (refresh token ou job). */
export const RENOVA_SOZINHO: ReadonlySet<string> = new Set([
  'facebook',
  'instagram',
  'mercadolivre',
  'tiny',
  'shopee',
  'tiktok',
  'amazon',
  'google',
]);

/** Dias antes do vencimento em que sai o e-mail (e o 0 = venceu hoje). */
export const DIAS_DE_AVISO = [30, 7, 1, 0] as const;

export interface ValidadeCredencial {
  expiraEm: Date | null;
  renovaSozinho: boolean;
}

/** `exp` de um JWT (sem validar assinatura — só ler a data). */
function expDoJwt(valor: string): Date | null {
  const partes = valor.split('.');
  if (partes.length !== 3) return null;
  try {
    const corpo = JSON.parse(Buffer.from(partes[1] ?? '', 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof corpo.exp === 'number' && corpo.exp > 0 ? new Date(corpo.exp * 1000) : null;
  } catch {
    return null;
  }
}

/** Número em ms ou s (epoch), ou texto ISO → Date. */
function comoData(v: unknown): Date | null {
  if (typeof v === 'number' && v > 0) return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function validadeDaCredencial(
  servico: string,
  cred: Record<string, unknown> | null | undefined,
): ValidadeCredencial {
  const renovaSozinho = RENOVA_SOZINHO.has(servico);
  if (!cred) return { expiraEm: null, renovaSozinho };

  // Meta: o token de USUÁRIO (~60 dias) é o que o job renova; o de acesso de
  // marketplace dura horas e mostrar essa data seria ruído.
  if (servico === 'facebook' || servico === 'instagram') {
    return { expiraEm: comoData(cred['userTokenExpiresAt']), renovaSozinho };
  }
  if (renovaSozinho) return { expiraEm: null, renovaSozinho };

  for (const campo of ['expiraEm', 'expiresAt', 'expires_at', 'tokenExpiresAt']) {
    const d = comoData(cred[campo]);
    if (d) return { expiraEm: d, renovaSozinho };
  }
  // Token que carrega a própria data (Melhor Envio é JWT de 1 ano).
  for (const v of Object.values(cred)) {
    if (typeof v !== 'string') continue;
    const d = expDoJwt(v);
    if (d) return { expiraEm: d, renovaSozinho };
  }
  return { expiraEm: null, renovaSozinho };
}

/** Dias inteiros até vencer, contados por data de São Paulo (negativo = vencido). */
export function diasParaVencer(expiraEm: Date, agora = new Date()): number {
  const dia = (d: Date) =>
    Date.parse(new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10));
  return Math.round((dia(expiraEm) - dia(agora)) / 86_400_000);
}
