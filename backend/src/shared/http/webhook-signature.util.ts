import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Utilitário para verificação de assinatura HMAC em webhooks.
 *
 * Cada plataforma tem seu próprio formato:
 *  - Meta/WhatsApp: header `x-hub-signature-256: sha256=<hex>`
 *  - OMIE: query param ou header customizado, dependendo da config
 *  - Mercado Livre: header `x-signature: ts=...,v1=<hex>`
 *
 * Sempre use `timingSafeEqual` pra comparação — evita timing attacks.
 */
export class WebhookSignatureUtil {
  /**
   * Verifica assinatura HMAC-SHA256 do payload.
   *
   * @param rawBody   Buffer ou string EXATA do corpo recebido (não pode ser o JSON parseado e re-serializado!)
   * @param signature Assinatura recebida (hex)
   * @param secret    Segredo compartilhado
   * @returns true se válida
   */
  static verifyHmacSha256(
    rawBody: Buffer | string,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature || !secret) return false;
    const cleanSig = signature.replace(/^sha256=/, '').trim().toLowerCase();
    if (!/^[0-9a-f]+$/i.test(cleanSig)) return false;

    const computed = createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
      .digest('hex');

    const a = Buffer.from(cleanSig, 'hex');
    const b = Buffer.from(computed, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Gera assinatura HMAC-SHA256 hex.
   * Útil pra outbound webhooks (a gente também emite).
   */
  static signHmacSha256(payload: Buffer | string, secret: string): string {
    return createHmac('sha256', secret)
      .update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload)
      .digest('hex');
  }
}
