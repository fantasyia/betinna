import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ShopeeSigner } from './shopee-signer';

const PARTNER_ID = '1000001';
const PARTNER_KEY = 'partner-key-abc';

const expectedHmac = (base: string) =>
  createHmac('sha256', PARTNER_KEY).update(base, 'utf8').digest('hex');

describe('ShopeeSigner.signPublic', () => {
  it('assina path + partner_id + timestamp', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const path = '/api/v2/auth/token/get';
    const ts = 1700000000;
    const r = s.signPublic(path, ts);
    expect(r.timestamp).toBe(ts);
    expect(r.sign).toBe(expectedHmac(`${PARTNER_ID}${path}${ts}`));
  });

  it('gera timestamp atual quando omitido', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const antes = Math.floor(Date.now() / 1000);
    const r = s.signPublic('/api/v2/common/x');
    const depois = Math.floor(Date.now() / 1000);
    expect(r.timestamp).toBeGreaterThanOrEqual(antes);
    expect(r.timestamp).toBeLessThanOrEqual(depois);
  });
});

describe('ShopeeSigner.signShop', () => {
  it('inclui access_token + shop_id na base', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const path = '/api/v2/sellerchat/get_message';
    const ts = 1700000000;
    const at = 'access-tok-xyz';
    const shop = '12345';
    const r = s.signShop(path, at, shop, ts);
    expect(r.sign).toBe(expectedHmac(`${PARTNER_ID}${path}${ts}${at}${shop}`));
  });

  it('aceita shop_id como número', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const r1 = s.signShop('/x', 'at', '999', 1);
    const r2 = s.signShop('/x', 'at', 999, 1);
    expect(r1.sign).toBe(r2.sign);
  });
});

describe('ShopeeSigner.signMerchant', () => {
  it('usa merchant_id no lugar de shop_id', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const path = '/api/v2/cb/some';
    const ts = 1700000000;
    const at = 'at';
    const mid = 'mch-1';
    const r = s.signMerchant(path, at, mid, ts);
    expect(r.sign).toBe(expectedHmac(`${PARTNER_ID}${path}${ts}${at}${mid}`));
  });
});

describe('ShopeeSigner.verifyWebhook', () => {
  it('aceita assinatura correta de "url|body"', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const url = 'https://app.betinna.ai/api/v1/webhooks/shopee';
    const body = '{"shop_id":12345,"code":7,"timestamp":1,"data":{}}';
    const sig = expectedHmac(`${url}|${body}`);
    expect(s.verifyWebhook(url, body, sig)).toBe(true);
  });

  it('aceita rawBody como Buffer', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const url = 'https://x/y';
    const body = '{"a":1}';
    const sig = expectedHmac(`${url}|${body}`);
    expect(s.verifyWebhook(url, Buffer.from(body, 'utf8'), sig)).toBe(true);
  });

  it('rejeita signature errada', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    expect(s.verifyWebhook('https://x', '{}', 'deadbeef')).toBe(false);
  });

  it('rejeita signature vazia', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    expect(s.verifyWebhook('https://x', '{}', '')).toBe(false);
  });

  it('rejeita quando body foi alterado', () => {
    const s = new ShopeeSigner(PARTNER_ID, PARTNER_KEY);
    const url = 'https://x';
    const sig = expectedHmac(`${url}|{"a":1}`);
    expect(s.verifyWebhook(url, '{"a":2}', sig)).toBe(false);
  });
});
