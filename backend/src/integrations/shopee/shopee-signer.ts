import { createHmac } from 'node:crypto';

/**
 * Assinador HMAC-SHA256 da Shopee Open Platform v2.
 *
 * A Shopee exige assinatura em CADA request. A fórmula depende do tipo de
 * endpoint:
 *
 *  - **Public** (auth, common): `HMAC(partner_id + path + timestamp, partner_key)`
 *  - **Shop**: `HMAC(partner_id + path + timestamp + access_token + shop_id, partner_key)`
 *  - **Merchant** (CB, cross-border): `HMAC(partner_id + path + timestamp + access_token + merchant_id, partner_key)`
 *
 * O resultado vai no query param `sign=<hex>`. `path` é só a parte da URL
 * relativa (ex: `/api/v2/auth/token/get`), SEM domínio nem query string.
 *
 * Tudo isolado aqui pra que possamos testar via vetores conhecidos.
 */
export class ShopeeSigner {
  constructor(
    private readonly partnerId: string,
    private readonly partnerKey: string,
  ) {}

  /**
   * Assina endpoint público (auth, common).
   * Retorna `{ sign, timestamp }` — timestamp gerado se não informado.
   */
  signPublic(path: string, timestamp?: number): { sign: string; timestamp: number } {
    const ts = timestamp ?? this.now();
    const base = `${this.partnerId}${path}${ts}`;
    return { sign: this.hmacHex(base), timestamp: ts };
  }

  /** Assina endpoint shop-level. */
  signShop(
    path: string,
    accessToken: string,
    shopId: string | number,
    timestamp?: number,
  ): { sign: string; timestamp: number } {
    const ts = timestamp ?? this.now();
    const base = `${this.partnerId}${path}${ts}${accessToken}${shopId}`;
    return { sign: this.hmacHex(base), timestamp: ts };
  }

  /** Assina endpoint merchant-level (cross-border). */
  signMerchant(
    path: string,
    accessToken: string,
    merchantId: string | number,
    timestamp?: number,
  ): { sign: string; timestamp: number } {
    const ts = timestamp ?? this.now();
    const base = `${this.partnerId}${path}${ts}${accessToken}${merchantId}`;
    return { sign: this.hmacHex(base), timestamp: ts };
  }

  /**
   * Verifica assinatura de webhook.
   *
   * Shopee envia push notifications com header `Authorization` = HMAC do
   * `url|body` (pipe literal). `url` aqui é a URL completa configurada no
   * dashboard (https://nosso-dominio/webhooks/shopee).
   *
   * @param fullUrl URL completa cadastrada no painel Shopee
   * @param rawBody Bytes EXATOS do body recebido (não JSON.stringify do parsed!)
   * @param signature valor do header Authorization
   */
  verifyWebhook(fullUrl: string, rawBody: Buffer | string, signature: string): boolean {
    if (!signature) return false;
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const base = `${fullUrl}|${bodyStr}`;
    const computed = this.hmacHex(base);
    return this.constantTimeEqual(signature.trim().toLowerCase(), computed.toLowerCase());
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private hmacHex(base: string): string {
    return createHmac('sha256', this.partnerKey).update(base, 'utf8').digest('hex');
  }

  private now(): number {
    return Math.floor(Date.now() / 1000);
  }

  /** Comparação em tempo constante (evita timing attacks). */
  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }
}
