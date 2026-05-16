import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TikTokSigner } from './tiktok-signer';

const APP_KEY = 'tk-app-key';
const APP_SECRET = 'tk-app-secret';

const hmacHex = (base: string) =>
  createHmac('sha256', APP_SECRET).update(base, 'utf8').digest('hex');

describe('TikTokSigner.sign', () => {
  it('aplica fórmula sandwich: secret + path + sorted_params + body + secret', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const path = '/order/202309/orders/search';
    const params = { app_key: APP_KEY, timestamp: '1700000000', shop_id: '12345' };
    const body = '{"page_size":50}';
    // sorted: app_key,shop_id,timestamp
    const expected = hmacHex(
      `${APP_SECRET}${path}app_key${APP_KEY}shop_id12345timestamp1700000000${body}${APP_SECRET}`,
    );
    expect(s.sign(path, params, body)).toBe(expected);
  });

  it('exclui sign e access_token dos params', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const path = '/x/y';
    const ts = '1700000000';
    const sigComExtras = s.sign(path, {
      app_key: APP_KEY,
      timestamp: ts,
      sign: 'should-not-be-included',
      access_token: 'should-not-be-included',
    });
    const sigSemExtras = s.sign(path, { app_key: APP_KEY, timestamp: ts });
    expect(sigComExtras).toBe(sigSemExtras);
  });

  it('ordena params alfabeticamente independente da ordem de entrada', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const sig1 = s.sign('/p', { zeta: 'z', alpha: 'a', mid: 'm' });
    const sig2 = s.sign('/p', { mid: 'm', alpha: 'a', zeta: 'z' });
    expect(sig1).toBe(sig2);
  });

  it('GET sem body funciona (body vazio)', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const path = '/x';
    const params = { app_key: APP_KEY, timestamp: '1' };
    const expected = hmacHex(`${APP_SECRET}${path}app_key${APP_KEY}timestamp1${APP_SECRET}`);
    expect(s.sign(path, params)).toBe(expected);
  });

  it('ignora valores undefined nos params', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const sigCom = s.sign('/x', { app_key: APP_KEY, timestamp: '1', foo: undefined });
    const sigSem = s.sign('/x', { app_key: APP_KEY, timestamp: '1' });
    expect(sigCom).toBe(sigSem);
  });
});

describe('TikTokSigner.verifyWebhook', () => {
  it('aceita assinatura HMAC(app_key + timestamp + rawBody) com app_secret', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const body = '{"type":"ORDER_STATUS_CHANGE","data":{}}';
    const ts = '1700000000';
    const sig = hmacHex(`${APP_KEY}${ts}${body}`);
    expect(s.verifyWebhook(body, sig, ts)).toBe(true);
  });

  it('aceita rawBody como Buffer', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const body = '{"a":1}';
    const ts = '99';
    const sig = hmacHex(`${APP_KEY}${ts}${body}`);
    expect(s.verifyWebhook(Buffer.from(body, 'utf8'), sig, ts)).toBe(true);
  });

  it('rejeita signature errada', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    expect(s.verifyWebhook('{}', 'deadbeef', '1')).toBe(false);
  });

  it('rejeita signature vazia', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    expect(s.verifyWebhook('{}', '', '1')).toBe(false);
  });

  it('rejeita quando body foi alterado', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    const ts = '1';
    const sigCorreto = hmacHex(`${APP_KEY}${ts}{"a":1}`);
    expect(s.verifyWebhook('{"a":2}', sigCorreto, ts)).toBe(false);
  });

  it('rejeita quando timestamp está ausente (auditoria 2026-05-15)', () => {
    const s = new TikTokSigner(APP_KEY, APP_SECRET);
    // Mesmo com signature que bate com timestamp vazio, rejeita
    const sigSemTs = hmacHex(`${APP_KEY}{}`);
    expect(s.verifyWebhook('{}', sigSemTs, undefined)).toBe(false);
    expect(s.verifyWebhook('{}', sigSemTs, '')).toBe(false);
  });
});
