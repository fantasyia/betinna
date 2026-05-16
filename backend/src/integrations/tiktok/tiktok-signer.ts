import { createHmac } from 'node:crypto';

/**
 * Assinador HMAC-SHA256 da TikTok Shop Partner API (v202309+).
 *
 * Fórmula sandwich:
 *  base = app_secret + path + sortedParamsConcatenated + jsonBody + app_secret
 *  sign = HMAC_SHA256(base, app_secret) → hex lowercase
 *
 * Onde:
 *  - `path` é só o caminho da URL (sem domínio, sem query)
 *  - `sortedParamsConcatenated` ordena params por nome (excluindo `sign` e
 *    `access_token`) e concatena `${key}${value}` em sequência sem separador
 *  - `jsonBody` é o body JSON cru (string) — vazio em GETs
 *
 * O sign vai em query `?sign=<hex>`.
 *
 * Webhook signing: mesma chave (app_secret) mas formato diferente —
 * `verifyWebhook` recebe rawBody e header `x-tts-signature` que é o HMAC do
 * `<app_key><timestamp><rawBody>`.
 */
export class TikTokSigner {
  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
  ) {}

  /**
   * Assina request da TikTok Shop API.
   * @param path Caminho relativo, ex: '/order/202309/orders/search'
   * @param queryParams params da query (exclui sign/access_token automaticamente)
   * @param body Body JSON serializado (string vazia em GET)
   */
  sign(
    path: string,
    queryParams: Record<string, string | number | undefined> = {},
    body: string = '',
  ): string {
    const excluded = new Set(['sign', 'access_token']);
    const entries = Object.entries(queryParams)
      .filter(([k, v]) => !excluded.has(k) && v !== undefined && v !== null)
      .map<[string, string]>(([k, v]) => [k, String(v)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const paramsConcat = entries.map(([k, v]) => `${k}${v}`).join('');
    const base = `${this.appSecret}${path}${paramsConcat}${body}${this.appSecret}`;
    return this.hmac(base);
  }

  /**
   * Verifica assinatura de webhook TikTok.
   *
   * O header `x-tts-signature` (ou `Authorization`, dependendo do tipo) contém
   * o HMAC SHA-256 hex de `<app_key><timestamp><rawBody>` com `app_secret`
   * como key. `timestamp` vem no header `x-timestamp` ou no próprio payload.
   */
  verifyWebhook(
    rawBody: Buffer | string,
    signature: string,
    timestamp?: number | string,
  ): boolean {
    if (!signature) return false;
    // Auditoria 2026-05-15: aceitar timestamp ausente abria caminho pra forja.
    // Agora timestamp é OBRIGATÓRIO — sem ele, rejeita.
    if (timestamp === undefined || timestamp === null || String(timestamp).length === 0) {
      return false;
    }
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const base = `${this.appKey}${String(timestamp)}${bodyStr}`;
    const computed = this.hmac(base);
    return this.constantTimeEqual(signature.trim().toLowerCase(), computed.toLowerCase());
  }

  // ─── Internos ────────────────────────────────────────────────────────

  private hmac(base: string): string {
    return createHmac('sha256', this.appSecret).update(base, 'utf8').digest('hex');
  }

  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }
}
