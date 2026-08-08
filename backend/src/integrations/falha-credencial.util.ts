/**
 * Distingue "falha passageira" (rate limit, timeout, 5xx do marketplace) de
 * "credencial morreu" (token revogado pelo seller, refresh expirado).
 *
 * Por que importa: os crons de 10min dos marketplaces logavam warn e seguiam —
 * o semáforo de integrações ficava 'ATIVA' com a conexão morta e a empresa só
 * descobria quando parava de responder cliente. Falha passageira só incrementa
 * o contador de erros; falha de credencial marca DESCONECTADO (alerta imediato,
 * porque exige alguém reconectar na mão).
 */
const PADROES_CREDENCIAL = [
  'invalid_grant',
  'invalid_token',
  'invalid_access_token',
  'token expired',
  'token_expired',
  'expired access token',
  'refresh token',
  'unauthorized',
  'forbidden',
  '401',
  '403',
];

export function ehFalhaDeCredencial(mensagem: string): boolean {
  const m = mensagem.toLowerCase();
  return PADROES_CREDENCIAL.some((p) => m.includes(p));
}
