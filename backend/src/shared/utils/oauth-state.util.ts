import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { UnauthorizedException } from '@shared/errors/app-exception';
import { ErrorCode } from '@shared/errors/error-codes';

/**
 * State JWT de OAuth (CSRF) — lógica ÚNICA dos 6 services (ML, Shopee, Amazon,
 * TikTok, Meta, Google). Antes cada um tinha `signState`/`verifyState`
 * byte-a-byte iguais (só mudava o salt e o claim eid/uid) — endurecer o CSRF
 * exigia 6 edições. Agora é um lugar só; cada service só declara salt + claim.
 *
 * NÃO é base class de propósito: os construtores/DI dos services divergem
 * (Meta/Google têm deps diferentes). São funções puras parametrizadas.
 */

/** Margem de validade do state (CSRF window). */
const STATE_TTL_MIN = 5;

/**
 * Deriva o secret do state a partir da `ENCRYPTION_KEY` + um salt por serviço
 * (isolamento criptográfico — D14). O salt DEVE ser estável por serviço (mudar
 * invalida states em voo): ml-oauth-state, shopee-oauth-state, amazon-lwa-state,
 * tiktok-oauth-state, meta-oauth-state, google-oauth-state.
 */
export function deriveOAuthStateSecret(encryptionKey: string, salt: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(encryptionKey).update(salt).digest());
}

/** Assina o state (HS256, TTL 5min, jti nonce) com um claim arbitrário. */
export async function signOAuthState(
  secret: Uint8Array,
  claim: Record<string, string>,
  ttlMin = STATE_TTL_MIN,
): Promise<string> {
  return new SignJWT(claim)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlMin}m`)
    .setJti(crypto.randomUUID())
    .sign(secret);
}

/**
 * Consumidor de nonce: retorna `true` se o `jti` NUNCA foi usado (e o marca como
 * usado), `false` se é replay. Injetado pelos services (Redis) — o util segue
 * puro e testável.
 */
export type ConsumirNonce = (jti: string, ttlSegundos: number) => Promise<boolean>;

/**
 * Verifica o state e devolve o valor do claim `claimKey` (ex: 'eid' ou 'uid').
 * Lança `UnauthorizedException` se inválido/expirado (CSRF protection).
 *
 * AUDITORIA #B17: o `jti` era GERADO na assinatura e nunca verificado — o D14
 * prometia anti-replay que não existia. Um callback de OAuth interceptado
 * (histórico do browser, log de proxy, referer) podia ser reenviado quantas
 * vezes quisesse dentro da janela de 5min, re-vinculando a integração. Com
 * `consumirNonce`, o primeiro uso queima o jti e os seguintes caem como
 * inválidos.
 */
export async function verifyOAuthState(
  secret: Uint8Array,
  state: string,
  claimKey: string,
  consumirNonce?: ConsumirNonce,
): Promise<string> {
  try {
    const { payload } = await jwtVerify(state, secret);
    const value = (payload as Record<string, unknown>)[claimKey];
    if (typeof value !== 'string' || value.length === 0) {
      throw new UnauthorizedException('state inválido', ErrorCode.AUTH_INVALID_TOKEN);
    }
    if (consumirNonce) {
      const jti = (payload as Record<string, unknown>)['jti'];
      if (typeof jti !== 'string' || !jti) {
        throw new UnauthorizedException('state sem nonce', ErrorCode.AUTH_INVALID_TOKEN);
      }
      // TTL = o que resta do próprio state (+30s de folga). Guardar mais tempo
      // que isso é desperdício: state expirado já é recusado pelo jwtVerify.
      const exp = typeof payload.exp === 'number' ? payload.exp : 0;
      const restam = Math.max(30, Math.ceil(exp - Date.now() / 1000) + 30);
      if (!(await consumirNonce(jti, restam))) {
        throw new UnauthorizedException(
          'state já utilizado (replay)',
          ErrorCode.AUTH_INVALID_TOKEN,
        );
      }
    }
    return value;
  } catch {
    throw new UnauthorizedException(
      'state inválido ou expirado (CSRF protection)',
      ErrorCode.AUTH_INVALID_TOKEN,
    );
  }
}
