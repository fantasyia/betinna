import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebhookSignatureUtil } from './webhook-signature.util';

const sign = (body: string, secret: string) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

describe('WebhookSignatureUtil', () => {
  const secret = 'super-segredo';
  const body = JSON.stringify({ event: 'cliente.alterado', codigo: 1001 });

  it('valida assinatura correta (hex puro)', () => {
    const sig = sign(body, secret);
    expect(WebhookSignatureUtil.verifyHmacSha256(body, sig, secret)).toBe(true);
  });

  it('valida assinatura com prefixo sha256=', () => {
    const sig = `sha256=${sign(body, secret)}`;
    expect(WebhookSignatureUtil.verifyHmacSha256(body, sig, secret)).toBe(true);
  });

  it('valida quando rawBody é Buffer', () => {
    const sig = sign(body, secret);
    expect(WebhookSignatureUtil.verifyHmacSha256(Buffer.from(body, 'utf8'), sig, secret)).toBe(
      true,
    );
  });

  it('rejeita assinatura errada', () => {
    expect(WebhookSignatureUtil.verifyHmacSha256(body, sign(body, 'outro-segredo'), secret)).toBe(
      false,
    );
  });

  it('rejeita quando body foi alterado', () => {
    const sig = sign(body, secret);
    expect(WebhookSignatureUtil.verifyHmacSha256(body + 'x', sig, secret)).toBe(false);
  });

  it('rejeita signature vazia', () => {
    expect(WebhookSignatureUtil.verifyHmacSha256(body, '', secret)).toBe(false);
  });

  it('rejeita secret vazio', () => {
    expect(WebhookSignatureUtil.verifyHmacSha256(body, sign(body, secret), '')).toBe(false);
  });

  it('rejeita signature não-hex', () => {
    expect(WebhookSignatureUtil.verifyHmacSha256(body, 'não-hex!!!', secret)).toBe(false);
  });

  it('rejeita signature de tamanho errado', () => {
    expect(WebhookSignatureUtil.verifyHmacSha256(body, 'abcd1234', secret)).toBe(false);
  });

  it('signHmacSha256 gera assinatura compatível com verify', () => {
    const sig = WebhookSignatureUtil.signHmacSha256(body, secret);
    expect(WebhookSignatureUtil.verifyHmacSha256(body, sig, secret)).toBe(true);
  });
});
